import { spawn, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { config } from '../config/env';
import EventEmitter from 'events';
import { NormalizedFormat } from './formatCache';
import { attemptsFor, baseArgs } from './ytdlpArgs';

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
  // Replace illegal Windows and Unix path characters. Node rejects non-Latin1 header bytes, so a Tamil/emoji title in Content-Disposition threw ERR_INVALID_CHAR and crashed the server on download (verified with the Tea video title); strip non-ASCII so the plain filename is ASCII-only.
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || 'video';
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
    let streamMode: StreamMode = 'direct';
      // Disk-buffered (process_first): yt-dlp downloads BOTH streams to disk first,
    // then FFmpeg merges them, so a live stream sends NO bytes for 1-3 minutes
    // while the download runs - proxies and clients time the idle connection out
    // and the download dies with 0 bytes (seen 2026-11-20 on the Tea video).
    // Buffering to disk first means the browser downloads a finished file with
    // Content-Length + Range support instead.
    if (format.type === 'video+audio' && format.videoFormatId && format.audioFormatId) {
      streamMode = 'process_first';
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
    const attempts = attemptsFor(url);
    const baseArgsFor = (attempt: { name: string; extractorArgs?: string }): string[] => {
      const a: string[] = ['-o', '-', ...baseArgs(attempt, url), '--newline'];
      if (isMerged) {
        a.push('-f', `${format.videoFormatId}+${format.audioFormatId}`);
        if (format.ext === 'mp4') {
          a.push('--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-movflags +frag_keyframe+empty_moov');
        } else {
          a.push('--merge-output-format', format.ext || 'mkv');
        }
      } else if (format.videoFormatId) {
        a.push('-f', format.videoFormatId);
      } else if (format.audioFormatId) {
        a.push('-f', format.audioFormatId);
      } else {
        a.push('-f', 'best');
      }
      a.push(url);
      return a;
    };
    return new Promise((resolve, reject) => {
      let resolved = false;
      let attemptIndex = 0;
      const tryAttempt = () => {
        const attempt = attempts[attemptIndex];
        console.log(`[FlowFetch] download attempt: ${attempt.name} for job ${id}`);
        const args = baseArgsFor(attempt);
        const child = spawn('yt-dlp', args);
        job.child = child;
        child.stderr.on('data', (data: Buffer) => {
          const output = data.toString();
          if (!resolved && output.includes('[info]')) {
            resolved = true;
            resolve();
          }
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
            attemptIndex += 1;
            if (attemptIndex < attempts.length) {
              console.warn(`[FlowFetch] download attempt ${attempt.name} failed for job ${id}, trying ${attempts[attemptIndex].name}`);
              tryAttempt();
              return;
            }
            resolved = true;
            this.updateProgress(id, { status: 'failed', error: 'EXTRACTION_BLOCKED' });
            reject(new Error('EXTRACTION_BLOCKED: Extraction blocked by source or network.'));
          }
        });
      };
      tryAttempt();
      job.timeout = setTimeout(() => {
        if (job.child) {
          job.child.kill('SIGKILL');
          this.jobs.delete(id);
        }
      }, 60000);
    });
  }

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
    const { format } = job;
    const safeTitle = sanitizeFilename(job.title);
    const resolutionSuffix = format.resolution ? ` - ${format.resolution}` : '';
    const safeFilename = `${safeTitle}${resolutionSuffix}.${format.ext}`; const fullFilename = `${job.title.replace(/[<>:\"/\|?*\x00-\x1F]/g, '').trim() || 'video'}${resolutionSuffix}.${format.ext}`;
    res.setHeader('Content-Type', contentTypeFor(format.ext));
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(fullFilename)}`);
    res.setHeader('Cache-Control', 'no-store');
    if (format.filesize && format.filesize > 0) {
      res.setHeader('Content-Length', format.filesize);
    }
    res.flushHeaders();
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
    res.on('close', () => {
      if (!job.child.killed) job.child.kill('SIGKILL');
    });
    res.on('error', () => {
      if (!job.child.killed) job.child.kill('SIGKILL');
    });
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

  private updateProgress(id: string, update: Partial<JobProgress>) {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = { ...job.progress, ...update };
      this.emit(`progress:${id}`, job.progress);
    }
  }

  // Disk download: now used for all video+audio merged formats (see createJob, streamMode 'process_first'), not just as a fallback.
  // yt-dlp + FFmpeg finish the merged file on disk first; the browser then downloads the finished file with Content-Length + Range support instead of a live stream.
  startDiskDownload(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const { format, url } = job;
    const finalExt = format.ext || 'mp4';
    const expectedFilename = `${id}.${finalExt}`;
    const outputPath = path.join(config.tempDir, 'files', expectedFilename);
    const attempts = attemptsFor(url);
    let attemptIndex = 0;
    const runAttempt = () => {
      const attempt = attempts[attemptIndex];
      console.log(`[FlowFetch] disk download attempt: ${attempt.name} for job ${id}`);
      const args = ['-o', outputPath, ...baseArgs(attempt, url)];
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
          attemptIndex += 1;
          if (attemptIndex < attempts.length) {
            console.warn(`[FlowFetch] disk job ${id} attempt ${attempt.name} failed, trying ${attempts[attemptIndex].name}`);
            runAttempt();
            return;
          }
          console.error(`[FlowFetch] Disk job ${id} failed:`, stderrOutput);
          const isBotBlock = /not a bot|Sign in to confirm/i.test(stderrOutput);
          
          this.updateProgress(id, {
            status: 'failed',
            error: isBotBlock
            ? 'BOT_BLOCKED: YouTube blocked this video (bot check).'
              : 'DOWNLOAD_FAILED: Download process failed.',
          });
        }
      });
    };
    runAttempt();
  }
}

export const downloader = new DownloaderService();
