import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { downloader } from '../services/downloader';
import { config } from '../config/env';
import { formatCache } from '../services/formatCache';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/download  –  Create a download job and return its ID + stream mode
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { analysisId, formatId } = req.body;

  if (!analysisId || !formatId) {
    return res.status(400).json({ success: false, error: 'analysisId and formatId are required' });
  }

  const analysis = formatCache.get(analysisId);
  if (!analysis) {
    return res
      .status(400)
      .json({ success: false, error: 'Analysis data expired or not found. Please analyze the URL again.' });
  }

  const format = analysis.formats.find((f) => f.id === formatId);
  if (!format) {
    return res.status(400).json({ success: false, error: 'Invalid format selected.' });
  }

  const { id: jobId, streamMode } = downloader.createJob(analysis.url, format, analysis.title);

  try {
    if (streamMode === 'process_first') {
      downloader.startDiskDownload(jobId);
    } else {
      await downloader.prepareStream(jobId);
    }
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }

  return res.json({ success: true, jobId, streamMode });
});

// ---------------------------------------------------------------------------
// GET /api/download/status/:jobId  –  Simple polling endpoint (Option B)
// ---------------------------------------------------------------------------
router.get('/status/:jobId', (req: Request, res: Response) => {
  const job = downloader.getJob(req.params.jobId as string);
  if (!job) return res.json({ status: 'failed' });
  if (job.progress.status === 'complete' && job.progress.filename) {
    return res.json({ status: 'ready', filename: job.progress.filename });
  }
  if (job.progress.status === 'failed') {
    return res.json({ status: 'failed' });
  }
  return res.json({ status: 'processing' });
});

// ---------------------------------------------------------------------------
// GET /api/download/:jobId  –  Deliver the file to the browser
//
// IMPORTANT: This endpoint is what the browser's native download manager talks
// to directly.  Once this response begins, the download is owned by the browser
// and continues independently of the React page that initiated it.
//
// Modes:
//   'direct'             – Audio-only or video-only single stream.
//                          yt-dlp stdout → response (no disk storage).
//   'process_and_stream' – Separate video+audio merged via FFmpeg.
//                          yt-dlp+FFmpeg stdout → response (fragmented MP4 or
//                          native WebM/MKV streaming).
//   'process_first'      – Disk-buffered fallback (merged MP4 after full
//                          server-side download).  Served with Range support so
//                          the browser can resume if interrupted.
// ---------------------------------------------------------------------------
router.get('/:jobId', async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = downloader.getJob(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Download not found or expired.' });
  }

  // ── Streaming modes ──────────────────────────────────────────────────────
  // For both 'direct' and 'process_and_stream', we call startStream() which:
  //   1. Sets Content-Type + Content-Disposition + calls res.flushHeaders() so
  //      the browser opens its Download Manager IMMEDIATELY on receiving headers.
  //   2. Spawns yt-dlp (and FFmpeg for merged formats) and pipes stdout → res.
  //   3. Listens for client disconnect and kills child processes accordingly.
  if (job.streamMode === 'direct' || job.streamMode === 'process_and_stream') {
    await downloader.startStream(jobId, res);
    return;
  }

  // ── Disk-buffered fallback (process_first) ────────────────────────────────
  // Only used if a future format type truly cannot be streamed.
  // Supports HTTP Range requests so the browser download manager can resume.
  if (job.progress.status !== 'complete' || !job.progress.filename) {
    if (job.progress.status === 'failed') {
      return res.status(400).json({ success: false, error: 'File download failed on server.' });
    }
    // Wait for the download to complete before serving the file
    try {
      await new Promise<void>((resolve, reject) => {
        const onProgress = (prog: any) => {
          if (prog.status === 'complete') {
            downloader.removeListener(`progress:${jobId}`, onProgress);
            resolve();
          } else if (prog.status === 'failed') {
            downloader.removeListener(`progress:${jobId}`, onProgress);
            reject(new Error('Download failed on server.'));
          }
        };
        downloader.on(`progress:${jobId}`, onProgress);
        
        // Handle client disconnect while waiting
        req.on('close', () => {
          downloader.removeListener(`progress:${jobId}`, onProgress);
        });
      });
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: err.message });
      }
      return;
    }
  }

  // Double check if filename is available after waiting
  if (!job.progress.filename) {
    return res.status(400).json({ success: false, error: 'File is not ready yet.' });
  }

  const filePath = path.join(config.tempDir, 'files', job.progress.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File no longer exists on the server.' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err: any) {
    console.error(`[FlowFetch] Error stating file ${filePath}:`, err.message);
    return res.status(500).json({ success: false, error: 'Failed to read completed file size on server.' });
  }

  if (stat.size === 0) {
    return res.status(500).json({ success: false, error: 'Extraction failed: Downloaded file is 0 bytes (blocked by source).' });
  }

  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  
  const sanitizeFilename = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'video';
  const safeTitle = sanitizeFilename(job.title);
  const resSuffix = job.format.resolution ? ` - ${job.format.resolution}` : '';
  const safeFilename = `${safeTitle}${resSuffix}.${job.format.ext}`;

  const ext = job.format.ext || 'mp4';
  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg',
    opus: 'audio/opus', flac: 'audio/flac', wav: 'audio/wav',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);

  if (rangeHeader) {
    // ── Partial content (HTTP 206) – enables browser download resume ─────
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    res.status(206);

    const fileStream = fs.createReadStream(filePath, { start, end });
    fileStream.on('error', (err) => {
      console.error('[FlowFetch] Range stream error:', err);
      if (!res.writableEnded) res.end();
    });
    fileStream.pipe(res);
  } else {
    // ── Full file ─────────────────────────────────────────────────────────
    res.setHeader('Content-Length', fileSize);
    res.status(200);

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error('[FlowFetch] File stream error:', err);
      if (!res.writableEnded) res.end();
    });
    fileStream.pipe(res);
  }
});

export default router;
