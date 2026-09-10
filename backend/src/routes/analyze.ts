import { Router, Request, Response } from 'express';
import { getMetadata, YtDlpFormat } from '../services/ytdlp';
import { formatCache, NormalizedFormat } from '../services/formatCache';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    let validUrl;
    try {
      validUrl = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
      return res.status(400).json({ success: false, error: 'Only HTTP/HTTPS URLs are supported' });
    }

    const metadata = await getMetadata(url);

    // Filter prohibited content (exploitative/illegal content)
    const prohibitedTerms = ['child porn', 'underage', 'preteen', 'jailbait'];
    const contentText = `${metadata.title} ${(metadata.tags || []).join(' ')} ${(metadata.categories || []).join(' ')}`.toLowerCase();
    
    if (prohibitedTerms.some(term => contentText.includes(term))) {
      return res.status(403).json({ success: false, error: 'Content violates safety guidelines and cannot be processed.' });
    }

    const videoOnly: YtDlpFormat[] = [];
    const audioOnly: YtDlpFormat[] = [];
    const combinedOriginal: YtDlpFormat[] = [];

    metadata.formats.forEach((f) => {
      if (f.vcodec !== 'none' && f.acodec !== 'none') {
        combinedOriginal.push(f);
      } else if (f.vcodec !== 'none' && f.acodec === 'none') {
        videoOnly.push(f);
      } else if (f.vcodec === 'none' && f.acodec !== 'none') {
        audioOnly.push(f);
      }
    });

    const normalizedFormats: NormalizedFormat[] = [];

    // Helper to format resolution text
    const getResText = (f: YtDlpFormat) => {
      if (f.height) return `${f.height}p`;
      if (f.resolution) return f.resolution.split('x')[1] ? `${f.resolution.split('x')[1]}p` : f.resolution;
      return 'Unknown';
    };

    // 1. Synthesize Video + Audio
    videoOnly.forEach(v => {
      // Find best audio matching container
      // Prefer m4a for mp4, else best bitrate
      let bestAudio = audioOnly.find(a => v.ext === 'mp4' ? a.ext === 'm4a' : true);
      if (!bestAudio && audioOnly.length > 0) {
        bestAudio = audioOnly[audioOnly.length - 1]; // usually last is highest quality in yt-dlp
      }

      if (bestAudio) {
        normalizedFormats.push({
          id: `combined-${v.format_id}-${bestAudio.format_id}`,
          type: 'video+audio',
          resolution: getResText(v),
          ext: v.ext === 'mp4' && bestAudio.ext === 'm4a' ? 'mp4' : v.ext,
          videoFormatId: v.format_id,
          audioFormatId: bestAudio.format_id,
          filesize: (v.filesize || v.filesize_approx || 0) + (bestAudio.filesize || bestAudio.filesize_approx || 0) || undefined,
          fps: v.fps,
          note: v.format_note
        });
      }
    });

    // Add fallback original progressive formats (only if we didn't synthesize a better one for that resolution)
    combinedOriginal.forEach(c => {
      const resText = getResText(c);
      if (!normalizedFormats.some(n => n.resolution === resText && n.type === 'video+audio')) {
        normalizedFormats.push({
          id: `raw-${c.format_id}`,
          type: 'video+audio',
          resolution: resText,
          ext: c.ext,
          videoFormatId: c.format_id,
          filesize: c.filesize || c.filesize_approx || undefined,
          fps: c.fps,
          note: c.format_note
        });
      }
    });

    // 2. Video Only
    videoOnly.forEach(v => {
      normalizedFormats.push({
        id: `video-${v.format_id}`,
        type: 'video',
        resolution: getResText(v),
        ext: v.ext,
        videoFormatId: v.format_id,
        filesize: v.filesize || v.filesize_approx || undefined,
        fps: v.fps,
        note: v.format_note
      });
    });

    // 3. Audio Only
    audioOnly.forEach(a => {
      normalizedFormats.push({
        id: `audio-${a.format_id}`,
        type: 'audio',
        resolution: 'Audio',
        ext: a.ext,
        audioFormatId: a.format_id,
        filesize: a.filesize || a.filesize_approx || undefined,
        note: a.format_note
      });
    });

    // Rank and deduplicate formats
    const uniqueMap = new Map<string, NormalizedFormat>();
    
    normalizedFormats.forEach(format => {
      // Create a grouping key. For 'video+audio' and 'video', we group by resolution.
      // For 'audio', we group by extension to keep one m4a and one mp3.
      let groupKey = '';
      if (format.type === 'audio') {
        groupKey = `audio-${format.ext}`;
      } else {
        // Group by type and resolution to only keep ONE best option per resolution
        groupKey = `${format.type}-${format.resolution}`;
      }

      const existing = uniqueMap.get(groupKey);
      if (!existing) {
        uniqueMap.set(groupKey, format);
      } else {
        // Ranking logic to decide which format wins:
        let scoreNew = 0;
        let scoreExisting = 0;

        // 1. Prefer MP4 output
        if (format.ext === 'mp4') scoreNew += 100;
        if (existing.ext === 'mp4') scoreExisting += 100;

        // 2. Prefer higher FPS
        if ((format.fps || 0) > (existing.fps || 0)) scoreNew += 50;
        if ((existing.fps || 0) > (format.fps || 0)) scoreExisting += 50;

        // 3. Prefer known filesize over unknown
        if (format.filesize && format.filesize > 0) scoreNew += 10;
        if (existing.filesize && existing.filesize > 0) scoreExisting += 10;

        // 4. Prefer higher video quality (larger filesize typically implies better bitrate if both are MP4)
        if (format.filesize && existing.filesize) {
          if (format.filesize > existing.filesize) scoreNew += 5;
          else scoreExisting += 5;
        }

        if (scoreNew > scoreExisting) {
          uniqueMap.set(groupKey, format);
        }
      }
    });

    const cleanFormats = Array.from(uniqueMap.values())
      .sort((a, b) => {
        // 1. Sort by type (video+audio, then video, then audio)
        const typeOrder = { 'video+audio': 0, 'video': 1, 'audio': 2 };
        if (typeOrder[a.type] !== typeOrder[b.type]) {
          return typeOrder[a.type] - typeOrder[b.type];
        }

        // 2. Sort by resolution descending
        const valA = parseInt(a.resolution.replace('p', '')) || 0;
        const valB = parseInt(b.resolution.replace('p', '')) || 0;
        
        if (valA !== valB) {
           return valB - valA;
        }
        
        return 0;
      });

    // Save to cache
    const analysisId = formatCache.save(url, cleanFormats, metadata.title);

    res.json({
      success: true,
      data: {
        analysisId, // Important: send analysisId to frontend
        title: metadata.title,
        thumbnail: metadata.thumbnail,
        duration: metadata.duration,
        uploader: metadata.uploader,
        site: metadata.extractor,
        description: metadata.description,
        age_limit: metadata.age_limit,
        formats: cleanFormats,
      }
    });

  } catch (error: any) {
    console.error('Analyze error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to analyze URL. The content might be private, protected, or unsupported.' 
    });
  }
});

export default router;
