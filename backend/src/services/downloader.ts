import { spawn, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { config } from '../config/env';
import EventEmitter from 'events';
import { NormalizedFormat } from './formatCache';

/**
 * StreamMode determines how a download job is served to the browser.
 *
 * 'direct'            – Single stream (video-only or audio-only).
 *                       yt-dlp stdout is piped straight to the HTTP response.
 *                       Browser download starts in <1 second.
 *
 * 'process_and_stream' – Separate video + audio streams that must be merged.
 *                        yt-dlp internally downloads both streams and runs
 *                        FFmpeg to merge them, piping the output to stdout.
 *                        For MP4 we inject -movflags +frag_keyframe+empty_moov
 *                        so the browser can start decoding before the stream ends.
 *                        Browser download starts as soon as FFmpeg produces output.
 *
 * 'process_first'     – Fallback for edge cases where streaming is not safe.
 *                        Full file is downloaded to disk first, then served.
 */
export type StreamMode = 'direct' | 'process_and_stream' | 'process_first';

export interface JobProgress {
  percent: number;
  downloaded: string;
  total: string;
  speed: string;
  eta: string;
  status: 'preparing' | 'downloading' | 'processing' | 'complete' | 'failed';
  filename?: string;
  error?: string;
}

export interface Job {
  id: string;
  url: string;
  title: string;
  format: NormalizedFormat;
  streamMode: StreamMode;
  progress: JobProgress;
  createdAt: number;
  child?: any;
  timeout?: NodeJS.Timeout;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const checkFFmpeg = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (error) => {
      resolve(!error);
    });
  });

/** Map container extension to a proper Content-Type value. */
function contentTypeFor(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    flac: 'audio/flac',
    wav: 'audio/wav',
  };
  return map[ext] ?? 'application/octet-stream';
}

function sanitizeFilename(name: string): string {
  // Replace illegal Windows and Unix path characters
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'video';
}

// --------------------------------------------------------------------------
// Service
// --------------------------------------------------------------------------

class DownloaderService extends EventEmitter {
  private jobs: Map<string, Job> = new Map();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  createJob(url: string, format: NormalizedFormat, title: string = 'video'): { id: string; streamMode: StreamMode } {
    const id = randomUUID();

    // Determine the streaming strategy.
    // direct:              Single audio-only or video-only stream. yt-dlp → response.
    // process_and_stream:  Separate video+audio merged via FFmpeg, piped directly
    //                      to the HTTP response as bytes are produced. Headers are
    //                      flushed BEFORE yt-dlp spawns so Chrome registers the
    //                      download entry immediately (Pattern A).
    let streamMode: StreamMode = 'direct';
    if (format.type === 'video+audio' && format.videoFormatId && format.audioFormatId) {
      streamMode = 'process_and_stream';
    }

    this.jobs.set(id, {
      id,
      url,
      title,
      format,
      streamMode,
      createdAt: Date.now(),
      progress: {
        percent: 0,
        downloaded: '0',
        total: '0',
        speed: '0',
        eta: 'Unknown',
        status: 'preparing',
      },
    });

    // Streaming jobs wait for the browser's GET request before doing any work.
    // Update status so the SSE channel shows something immediately.
    this.updateProgress(id, { status: 'preparing' });

    return { id, streamMode };
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  async prepareStream(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job not found');

    const { format, url } = job;
    const isMerged = format.type === 'video+audio' && format.videoFormatId && format.audioFormatId;

    if (isMerged) {
      const hasFFmpeg = await checkFFmpeg();
      if (!hasFFmpeg) {
        this.updateProgress(id, { status: 'failed', error: 'FFMPEG_MISSING' });
        throw new Error('FFmpeg not found on server.');
      }
    }

    const args: string[] = ['-o', '-', '--no-playlist', '--newline'];
    if (isMerged) {
      args.push('-f', `${format.videoFormatId}+${format.audioFormatId}`);
      if (format.ext === 'mp4') {
        args.push('--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-movflags +frag_keyframe+empty_moov');
      } else {
        args.push('--merge-output-format', format.ext || 'mkv');
      }
    } else if (format.videoFormatId) {
      args.push('-f', format.videoFormatId);
    } else if (format.audioFormatId) {
      args.push('-f', format.audioFormatId);
    } else {
      args.push('-f', 'best');
    }
    args.push(url);

    return new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', args);
      job.child = child;
      let resolved = false;

      child.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        
        // Resolve early if we see [info], meaning extraction successfully started.
        // We leave stdout untouched; Node will buffer it (paused mode) until piped.
        if (!resolved && output.includes('[info]')) {
          resolved = true;
          resolve();
        }

        // Parse progress for SSE
        const dlMatch = output.match(/\[download\]\s+([\d.]+)%\s+of\s+([~\d.]+(?:MiB|GiB|KiB|B))\s+at\s+([~\d.]+(?:MiB|KiB)\/s|Unknown)\s+ETA\s+([\d:]+|Unknown)/i);
        if (dlMatch) {
          const pct = parseFloat(dlMatch[1]);
          const totalStr = dlMatch[2].replace('~', '');
          const totalNum = parseFloat(totalStr);
          const unit = totalStr.replace(/[\d.]/g, '');
          const downloadedStr = isNaN(totalNum) ? '' : `${(totalNum * pct / 100).toFixed(2)}${unit}`;
          this.updateProgress(id, {
            status: 'downloading', percent: pct, total: totalStr, downloaded: downloadedStr,
            speed: dlMatch[3].replace('~', ''), eta: dlMatch[4],
          });
        }
        if (output.includes('[Merger]') || output.includes('Merging formats into')) {
          this.updateProgress(id, { status: 'processing' });
        }
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          this.updateProgress(id, { status: 'failed', error: 'EXTRACTION_BLOCKED' });
          reject(new Error('EXTRACTION_BLOCKED: Extraction blocked by source or network.'));
        }
      });

      // Cleanup if GET request never arrives
      job.timeout = setTimeout(() => {
        if (job.child) {
          job.child.kill('SIGKILL');
          this.jobs.delete(id);
        }
      }, 60000);
    });
  }

  // -----------------------------------------------------------------------
  // Streaming delivery – called when the browser hits GET /api/download/:id
  // -----------------------------------------------------------------------

  async startStream(id: string, res: any): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || !job.child) {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'Job not ready or not found' });
      return;
    }

    if (job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = undefined;
    }

    // Set headers
    const { format } = job;
    const safeTitle = sanitizeFilename(job.title);
    const resolutionSuffix = format.resolution ? ` - ${format.resolution}` : '';
    const safeFilename = `${safeTitle}${resolutionSuffix}.${format.ext}`;

    res.setHeader('Content-Type', contentTypeFor(format.ext));
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (format.filesize && format.filesize > 0) {
      res.setHeader('Content-Length', format.filesize);
    }
    res.flushHeaders();

    // Disable idle timeout
    const sock = (res as any).socket;
    if (sock) {
      sock.setTimeout(0);
      sock.setKeepAlive(true, 30_000);
    }

    this.updateProgress(id, { status: 'downloading' });

    let bytesTransferred = 0;
    job.child.stdout.on('data', (chunk: Buffer) => {
      bytesTransferred += chunk.length;
      res.write(chunk);
    });

    job.child.stdout.on('end', () => {
      if (!res.writableEnded) res.end();
    });

    job.child.stdout.resume();

    // Handle process exit
    job.child.on('close', (code: number | null) => {
      if (code === 0) {
        console.log(`[ADULT-DOWNLOAD] response finished for job ${id}, bytes transferred: ${bytesTransferred}`);
        this.updateProgress(id, { status: 'complete', percent: 100 });
      } else {
        console.error(`[FlowFetch] Job ${id} stream process exited with code ${code}`);
        this.updateProgress(id, {
          status: 'failed',
          error: 'DOWNLOAD_FAILED: Download process failed.',
        });
        if (!res.writableEnded) res.end();
      }
    });

    // Client disconnect
    res.on('close', () => {
      if (!job.child.killed) job.child.kill('SIGKILL');
    });
    res.on('error', () => {
      if (!job.child.killed) job.child.kill('SIGKILL');
    });

    // ------------------------------------------------------------------
    // Client disconnect → kill child processes immediately.
    // This prevents wasted bandwidth and orphaned yt-dlp / FFmpeg processes.
    // ------------------------------------------------------------------
    res.on('close', () => {
      if (!job.child.killed) {
        job.child.kill('SIGKILL');
      }
    });

    res.on('error', (err: Error) => {
      console.error(`[FlowFetch] Response stream error for job ${id}:`, err.message);
      if (!job.child.killed) {
        job.child.kill('SIGKILL');
      }
    });
  }

  // -----------------------------------------------------------------------
  // Fallback: save to disk first, then serve (process_first mode).
  // Currently not assigned to any format but kept for safety.
  // -----------------------------------------------------------------------

  private updateProgress(id: string, update: Partial<JobProgress>) {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = { ...job.progress, ...update };
      this.emit(`progress:${id}`, job.progress);
    }
  }

  startDiskDownload(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;

    const { format, url } = job;
    const finalExt = format.ext || 'mp4';
    const expectedFilename = `${id}.${finalExt}`;
    const outputPath = path.join(config.tempDir, 'files', expectedFilename);

    const args = ['-o', outputPath, '--no-playlist'];

    if (format.type === 'video+audio' && format.videoFormatId && format.audioFormatId) {
      args.push('-f', `${format.videoFormatId}+${format.audioFormatId}`);
      args.push('--merge-output-format', format.ext || 'mp4');
    } else if (format.videoFormatId) {
      args.push('-f', format.videoFormatId);
    } else if (format.audioFormatId) {
      args.push('-f', format.audioFormatId);
    } else {
      args.push('-f', 'best');
    }
    args.push(url);

    const child = spawn('yt-dlp', args);
    let finalFilename = '';

    child.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      const dlMatch = output.match(
        /\[download\]\s+([\d.]+)%\s+of\s+([~\d.]+(?:MiB|GiB|KiB|B))\s+at\s+([~\d.]+(?:MiB|KiB)\/s|Unknown)\s+ETA\s+([\d:]+|Unknown)/i,
      );
      if (dlMatch) {
        this.updateProgress(id, {
          status: 'downloading',
          percent: parseFloat(dlMatch[1]),
          total: dlMatch[2].replace('~', ''),
          speed: dlMatch[3].replace('~', ''),
          eta: dlMatch[4],
        });
      }
      if (output.includes('[Merger]') || output.includes('Merging formats into')) {
        this.updateProgress(id, { status: 'processing' });
      }
    });

    let stderrOutput = '';
    child.stderr.on('data', (data: Buffer) => { stderrOutput += data.toString(); });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        this.updateProgress(id, { status: 'complete', percent: 100, filename: expectedFilename });
      } else {
        console.error(`[FlowFetch] Disk job ${id} failed:`, stderrOutput);
        this.updateProgress(id, {
          status: 'failed',
          error: 'DOWNLOAD_FAILED: Download process failed.',
        });
      }
    });
  }
}

export const downloader = new DownloaderService();
