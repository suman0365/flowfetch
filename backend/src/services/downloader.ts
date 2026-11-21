import { spawn, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { config } from '../config/env';
import EventEmitter from 'events';
import { NormalizedFormat } from './formatCache';
import { attemptsFor, baseArgs } from './ytdlpArgs';

/**
 * StreamMode — how a download job is served to the browser.
 *
 * 'direct'       – Single stream (video-only, audio-only, or a progressive
 *                  combined format such as YouTube 18/22). yt-dlp stdout is
 *                  piped straight to the HTTP response. The size is known
 *                  exactly, so Content-Length is set and Chrome shows a
 *                  true 0–100% download progress in its Downloads.
 *
 * 'stream_merge' – DASH video+audio (two separate streams). Two yt-dlp
 *                  processes stream the raw video and audio into FFmpeg,
 *                  which muxes them into a fragmented MP4 (or Matroska
 *                  for webm/mkv) on stdout, piped straight to the HTTP
 *                  response. Headers are sent immediately so the browser
 *                  download entry appears at once; the final size is NOT
 *                  known in advance (the merge adds container overhead),
 *                  so no Content-Length is sent and Chrome shows bytes
 *                  counting up instead of a percentage.
 *
 * There is deliberately NO disk-buffered mode any more (v13, 2026-11-21):
 * Suman asked for the download to start instantly in the browser's own
 * Downloads, not a "Preparing... 0–100%" phase on the site followed by
 * a second click. The old yt-dlp built-in merger is NOT used here, because
 * merging to a pipe makes yt-dlp emit MPEG-TS mislabelled as MP4 —
 * verified locally 2026-11-21: first bytes are 0x47 sync + "FFmpeg
 * Service01", ffprobe says format_name=mpegts. The dual-process +
 * FFmpeg pipeline below produces a genuine fragmented MP4 (ftypiso5,
 * decodes cleanly end to end, h264 + aac).
 */
export type StreamMode = 'direct' | 'stream_merge';

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
  started?: boolean;
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
  // Replace illegal Windows and Unix path characters, then strip every
  // non-ASCII character (Tamil letters, emoji, etc.). Node's HTTP layer
  // rejects non-Latin1 bytes in header values, so a Tamil/emoji title in
  // Content-Disposition threw ERR_INVALID_CHAR and crashed the whole
  // server on download — verified 2026-11-20 with the Tea video title.
  // The browser still gets the real title via filename*=UTF-8'' below.
  return name.replace(/[<>:\"/\\|?*\x00-\x1F]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || 'video';
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

    // Single stream → direct pipe. Two streams (video+audio) → live merge.
    // A progressive combined format (YouTube 18/22) has only a
    // videoFormatId, so it correctly lands in 'direct'.
    let streamMode: StreamMode = 'direct';
    if (format.type === 'video+audio' && format.videoFormatId && format.audioFormatId) {
      streamMode = 'stream_merge';
    }

    const job: Job = {
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
    };
    this.jobs.set(id, job);

    // A job is created when the user SELECTS a format (prefetch) so the
    // Download click can fire the browser download synchronously. If they
    // never click, drop the record after 30 minutes instead of leaking it.
    job.timeout = setTimeout(() => {
      if (!job.started) this.jobs.delete(id);
    }, 30 * 60 * 1000);

    return { id, streamMode };
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  // -----------------------------------------------------------------------
  // Shared response setup — headers go out FIRST so the browser download
  // entry appears in Chrome Downloads immediately, before the first byte
  // of media exists. That is the whole point of v13: no site-side
  // "Preparing..." phase, the download lives in the browser from tap one.
  // -----------------------------------------------------------------------

  private sendDownloadHeaders(job: Job, res: any, knownSize: boolean): void {
    const { format } = job;
    const safeTitle = sanitizeFilename(job.title);
    const resolutionSuffix = format.resolution ? ` - ${format.resolution}` : '';
    const safeFilename = `${safeTitle}${resolutionSuffix}.${format.ext}`;
    // Full title (Tamil/emoji kept) for the RFC 5987 filename* value only.
    const fullFilename = `${job.title.replace(/[<>:\"/\\|?*\x00-\x1F]/g, '').trim() || 'video'}${resolutionSuffix}.${format.ext}`;

    res.setHeader('Content-Type', contentTypeFor(format.ext));
    // Plain filename="..." must be ASCII-only (Node rejects non-Latin1
    // header bytes); the RFC 5987 filename* carries the real title.
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(fullFilename)}`);
    res.setHeader('Cache-Control', 'no-store');
    // Exact size is known only for a single stream. For a live merge the
    // size is unknown until the merge finishes, so no Content-Length:
    // chunked transfer, Chrome shows bytes counting up. Never send a
    // guessed Content-Length — a wrong value truncates or hangs the file.
    if (knownSize && format.filesize && format.filesize > 0) {
      res.setHeader('Content-Length', format.filesize);
    }
    res.flushHeaders();

    // Disable idle timeout: a merge can take a while before the first
    // bytes flow, and Node's default 5s idle socket timeout would kill it.
    const sock = (res as any).socket;
    if (sock) {
      sock.setTimeout(0);
      sock.setKeepAlive(true, 30_000);
    }
  }

  private markStarted(job: Job): void {
    job.started = true;
    if (job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Direct single-stream delivery — GET /api/download/:id
  // -----------------------------------------------------------------------

  async startStream(id: string, res: any): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'Job not found or expired' });
      return;
    }
    this.markStarted(job);

    // Headers first: the download entry appears in Chrome instantly.
    this.sendDownloadHeaders(job, res, true);
    this.updateProgress(id, { status: 'downloading' });

    const attempts = attemptsFor(job.url);
    let bytesWritten = 0;
    for (let i = 0; i < attempts.length; i++) {
      if (res.destroyed || res.writableEnded) break;
      const attempt = attempts[i];
      console.log(`[FlowFetch] stream attempt: ${attempt.name} for job ${id}`);
      const r = await this.runDirectAttempt(job, attempt, res);
      bytesWritten += r.bytes;
      if (r.ok) {
        this.updateProgress(id, { status: 'complete', percent: 100 });
        return;
      }
      // A partial file is already on its way to the browser; retrying
      // would append a second stream to the same response and corrupt it.
      if (bytesWritten > 0) break;
      console.warn(`[FlowFetch] stream attempt ${attempt.name} failed for job ${id}, trying next client`);
    }

    this.updateProgress(id, { status: 'failed', error: 'DOWNLOAD_FAILED: Download process failed.' });
    if (!res.writableEnded && !res.destroyed) res.end();
  }

  /** One yt-dlp client attempt for a single stream. Resolves false on failure. */
  private runDirectAttempt(
    job: Job,
    attempt: { name: string; extractorArgs?: string },
    res: any,
  ): Promise<{ ok: boolean; bytes: number }> {
    return new Promise((resolve) => {
      const { format, url } = job;
      const args: string[] = ['-o', '-', ...baseArgs(attempt, url), '--newline'];
      if (format.videoFormatId) args.push('-f', format.videoFormatId);
      else if (format.audioFormatId) args.push('-f', format.audioFormatId);
      else args.push('-f', 'best');
      args.push(url);

      const child = spawn('yt-dlp', args);
      job.child = child;
      let bytes = 0;
      let settled = false;
      let stderrOutput = '';
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try { if (!child.killed) child.kill('SIGKILL'); } catch { /* already dead */ }
        resolve({ ok, bytes });
      };

      child.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        const dlMatch = output.match(/\[download\]\s+([\d.]+)%/i);
        if (dlMatch) {
          this.updateProgress(job.id, { status: 'downloading', percent: parseFloat(dlMatch[1]) });
        }
      });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (!res.writableEnded && !res.destroyed) res.write(chunk);
      });
      child.on('close', (code) => {
        if (settled) return; // already resolved (e.g. browser closed first)
        if (code === 0) {
          if (!res.writableEnded && !res.destroyed) res.end();
          done(true);
        } else {
          console.warn(`[FlowFetch] stream ${attempt.name} exited ${code} for job ${job.id}:`, stderrOutput.slice(-300));
          done(false);
        }
      });
      child.on('error', () => done(false));
      // Browser closed the download (user cancelled / navigated away).
      res.once('close', () => done(false));
    });
  }

  // -----------------------------------------------------------------------
  // Live-merge delivery — GET /api/download/:id for video+audio formats.
  // Two yt-dlp processes stream the raw video and audio into FFmpeg,
  // which muxes a fragmented MP4 (or Matroska for webm/mkv) to stdout.
  // -----------------------------------------------------------------------

  async startMergeStream(id: string, res: any): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'Job not found or expired' });
      return;
    }
    this.markStarted(job);

    const hasFFmpeg = await checkFFmpeg();
    if (!hasFFmpeg) {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'FFmpeg not found on server.' });
      return;
    }

    // Headers first: the download entry appears in Chrome instantly.
    this.sendDownloadHeaders(job, res, false);
    this.updateProgress(id, { status: 'downloading' });

    const attempts = attemptsFor(job.url);
    let bytesWritten = 0;
    for (let i = 0; i < attempts.length; i++) {
      if (res.destroyed || res.writableEnded) break;
      const attempt = attempts[i];
      console.log(`[FlowFetch] merge-stream attempt: ${attempt.name} for job ${id}`);
      const r = await this.runMergeAttempt(job, attempt, res);
      bytesWritten += r.bytes;
      if (r.ok) {
        this.updateProgress(id, { status: 'complete', percent: 100 });
        return;
      }
      // A partial file is already on its way to the browser; retrying
      // would append a second stream to the same response and corrupt it.
      if (bytesWritten > 0) break;
      console.warn(`[FlowFetch] merge-stream attempt ${attempt.name} failed for job ${id}, trying next client`);
    }

    this.updateProgress(id, { status: 'failed', error: 'DOWNLOAD_FAILED: Download process failed.' });
    if (!res.writableEnded && !res.destroyed) res.end();
  }

  /**
   * One merge attempt: yt-dlp (video) + yt-dlp (audio) + FFmpeg.
   * The two yt-dlp stdouts are piped into FFmpeg's extra file
   * descriptors 3 and 4; FFmpeg's stdout is piped to the HTTP response.
   * If either yt-dlp fails before any bytes reach the browser, fail fast
   * so the next client can be tried without waiting for the other
   * stream to finish downloading.
   */
  private runMergeAttempt(
    job: Job,
    attempt: { name: string; extractorArgs?: string },
    res: any,
  ): Promise<{ ok: boolean; bytes: number }> {
    return new Promise((resolve) => {
      const { format, url } = job;
      const vArgs = ['-o', '-', ...baseArgs(attempt, url), '--newline', '-f', format.videoFormatId!, url];
      const aArgs = ['-o', '-', ...baseArgs(attempt, url), '--newline', '-f', format.audioFormatId!, url];
      const vChild = spawn('yt-dlp', vArgs);
      const aChild = spawn('yt-dlp', aArgs);

      // Fragmented MP4 for .mp4 (moov up front, playable while streaming);
      // Matroska for .webm/.mkv (no movflags needed, streams natively).
      const isWebm = format.ext === 'webm' || format.ext === 'mkv';
      const ffArgs = isWebm
        ? ['-v', 'error', '-i', 'pipe:3', '-i', 'pipe:4', '-map', '0:v', '-map', '1:a', '-c', 'copy', '-f', 'matroska', 'pipe:1']
        : ['-v', 'error', '-i', 'pipe:3', '-i', 'pipe:4', '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'];
      const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
      job.child = ff;

      // Feed the two raw streams into FFmpeg's extra fds.
      vChild.stdout.pipe((ff.stdio as any)[3]);
      aChild.stdout.pipe((ff.stdio as any)[4]);

      let bytes = 0;
      let settled = false;
      let stderrOutput = '';
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        [vChild, aChild, ff].forEach((c) => {
          try { if (!c.killed) c.kill('SIGKILL'); } catch { /* already dead */ }
        });
        resolve({ ok, bytes });
      };

      const collectErr = (data: Buffer) => { stderrOutput += data.toString(); };
      vChild.stderr.on('data', collectErr);
      aChild.stderr.on('data', collectErr);
      ff.stderr!.on('data', collectErr);

      ff.stdout!.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (!res.writableEnded && !res.destroyed) res.write(chunk);
      });
      ff.on('close', (code) => {
        if (settled) return; // already resolved (e.g. browser closed first)
        if (code === 0) {
          if (!res.writableEnded && !res.destroyed) res.end();
          done(true);
        } else {
          console.warn(`[FlowFetch] merge ffmpeg exited ${code} for job ${job.id}:`, stderrOutput.slice(-400));
          done(false);
        }
      });
      ff.on('error', () => done(false));
      vChild.on('error', () => done(false));
      aChild.on('error', () => done(false));
      // Fail fast: if one side errors before any bytes were produced,
      // don't wait for the other side's download to finish first.
      vChild.on('close', (code) => { if (code !== 0 && bytes === 0) done(false); });
      aChild.on('close', (code) => { if (code !== 0 && bytes === 0) done(false); });
      // Browser closed the download (user cancelled / navigated away).
      res.once('close', () => done(false));
    });
  }

  // -----------------------------------------------------------------------
  // Progress (SSE channel + status reads)
  // -----------------------------------------------------------------------

  private updateProgress(id: string, update: Partial<JobProgress>) {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = { ...job.progress, ...update };
      this.emit(`progress:${id}`, job.progress);
    }
  }
}

export const downloader = new DownloaderService();
