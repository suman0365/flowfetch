import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import EventEmitter from 'events';
import { NormalizedFormat } from './formatCache';
import { attemptsFor, baseArgs } from './ytdlpArgs';

/**
 * StreamMode — how a download job is served to the browser.
 *
 * 'direct'     – Single stream (video-only, audio-only, or a progressive
 *                combined format such as YouTube 18/22). yt-dlp stdout is
 *                piped straight to the HTTP response. The size is known
 *                exactly, so Content-Length is set and Chrome shows a
 *                true 0–100% download progress in its Downloads.
 *
 * 'disk_build' – DASH video+audio (two separate streams). The file is
 *                built on the server disk first (ONE yt-dlp process at a
 *                time, which downloads both streams and lets FFmpeg merge
 *                them), then streamed to the browser. The response headers
 *                are sent BEFORE the build starts, so the download entry
 *                appears in Chrome Downloads the instant the user taps
 *                Download — there is no site-side "Preparing..." phase and
 *                no second click. The download sits at 0% while the file
 *                builds, then fills 0–100% natively in the browser.
 *
 * Why disk-build and not a live merge (v13, 2026-11-21)? The live merge
 * ran TWO yt-dlp processes concurrently, each spawning a Deno JS runtime
 * for extraction, plus FFmpeg — and that blew past Render's 512 MB free
 * tier on EVERY merge (OOM-restarted at 10:15, 10:18, 10:27, 10:29 IST,
 * even for an 8 MB 144p file). One yt-dlp at a time fits comfortably,
 * and this exact disk build already proved itself: Suman's Big Buck
 * Bunny 240p file built fine on the server on 2026-11-21 (32 MB, valid
 * MP4, served HTTP 200). The live merge also has no fragment retry, so
 * a single mid-download 403 kills the whole pipe; the disk build lets
 * yt-dlp retry fragments internally.
 *
 * The old yt-dlp built-in merger to a pipe is NOT used anywhere: merging
 * to stdout makes yt-dlp emit MPEG-TS mislabelled as MP4 (verified
 * 2026-11-21: first bytes 0x47 sync + "FFmpeg Service01", ffprobe
 * format_name=mpegts).
 */
export type StreamMode = 'direct' | 'disk_build';

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
  // Disk-build state (disk_build mode only).
  buildPromise?: Promise<{ ok: boolean; filePath?: string }>;
  filePath?: string;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

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

    // Single stream → direct pipe. Two streams (video+audio) → build on
    // disk first, then stream the finished file (see the header comment).
    // A progressive combined format (YouTube 18/22) has only a
    // videoFormatId, so it correctly lands in 'direct'.
    let streamMode: StreamMode = 'direct';
    if (format.type === 'video+audio' && format.videoFormatId && format.audioFormatId) {
      streamMode = 'disk_build';
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
    // Exact size is known only for a single stream. For a disk build the
    // size is unknown until the merge finishes, so no Content-Length:
    // chunked transfer, Chrome shows bytes counting up. Never send a
    // guessed Content-Length — a wrong value truncates or hangs the file.
    if (knownSize && format.filesize && format.filesize > 0) {
      res.setHeader('Content-Length', format.filesize);
    }
    res.flushHeaders();

    // Disable idle timeout: a disk build can take a while before the
    // first bytes flow, and Node's default 5s idle socket timeout would
    // kill it.
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
  // Disk-build delivery — GET /api/download/:id for video+audio formats.
  // Headers go out immediately (the download entry appears in Chrome at
  // once), the merged file is built on disk, then streamed to the
  // browser. One tap, no second click, no site-side Preparing phase.
  // -----------------------------------------------------------------------

  async startDiskBuildStream(id: string, res: any): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'Job not found or expired' });
      return;
    }
    this.markStarted(job);

    // Headers first: the download entry appears in Chrome instantly.
    this.sendDownloadHeaders(job, res, false);
    this.updateProgress(id, { status: 'downloading' });

    // If the browser goes away mid-build, stop the build so it does not
    // burn the free instance's CPU/RAM for nothing.
    let cancelled = false;
    res.once('close', () => {
      cancelled = true;
      if (job.child && !job.child.killed) {
        try { job.child.kill('SIGKILL'); } catch { /* already dead */ }
      }
    });

    const result = await this.runDiskBuild(job);
    if (cancelled || res.destroyed || res.writableEnded) return;

    if (!result.ok || !result.filePath || !fs.existsSync(result.filePath)) {
      this.updateProgress(id, { status: 'failed', error: 'DOWNLOAD_FAILED: Download process failed.' });
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }

    // Stream the finished file to the browser. (Content-Length was not
    // sent — headers went out before the build — so this is chunked and
    // Chrome shows bytes counting up.)
    job.filePath = result.filePath;
    const stream = fs.createReadStream(result.filePath);
    stream.on('error', () => {
      this.updateProgress(id, { status: 'failed', error: 'DOWNLOAD_FAILED: Could not read built file.' });
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    stream.on('end', () => {
      this.updateProgress(id, { status: 'complete', percent: 100 });
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    stream.pipe(res);
  }

  /**
   * Build the merged file on disk. ONE yt-dlp process at a time (with its
   * FFmpeg merge) — this is what fits in Render's 512 MB and what already
   * proved itself on 2026-11-21. Clients are tried in order; yt-dlp
   * retries fragments internally, so a brief block does not kill the
   * whole download the way a live pipe does.
   */
  private runDiskBuild(job: Job): Promise<{ ok: boolean; filePath?: string }> {
    if (job.buildPromise) return job.buildPromise;
    job.buildPromise = this.doDiskBuild(job);
    return job.buildPromise;
  }

  private async doDiskBuild(job: Job): Promise<{ ok: boolean; filePath?: string }> {
    const { format, url } = job;
    const filesDir = path.join(config.tempDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    const outPath = path.join(filesDir, `${job.id}.${format.ext}`);
    const mergeFormat = format.ext === 'webm' || format.ext === 'mkv' ? 'webm' : 'mp4';

    const attempts = attemptsFor(url);
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      console.log(`[FlowFetch] disk-build attempt: ${attempt.name} for job ${job.id}`);
      const ok = await this.runDiskBuildAttempt(job, attempt, outPath, mergeFormat);
      if (ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        this.updateProgress(job.id, {
          status: 'complete',
          percent: 100,
          filename: path.basename(outPath),
        });
        return { ok: true, filePath: outPath };
      }
      // A failed attempt may leave a partial file behind; remove it so
      // the next client starts clean.
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* ignore */ }
      console.warn(`[FlowFetch] disk-build attempt ${attempt.name} failed for job ${job.id}, trying next client`);
    }

    this.updateProgress(job.id, { status: 'failed', error: 'DOWNLOAD_FAILED: Download process failed.' });
    return { ok: false };
  }

  /** One yt-dlp client attempt for a disk build. Resolves false on failure. */
  private runDiskBuildAttempt(
    job: Job,
    attempt: { name: string; extractorArgs?: string },
    outPath: string,
    mergeFormat: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const { format, url } = job;
      const args: string[] = [
        '-o', outPath,
        ...baseArgs(attempt, url),
        '--newline',
        '-f', `${format.videoFormatId}+${format.audioFormatId}`,
        '--merge-output-format', mergeFormat,
        url,
      ];
      const child = spawn('yt-dlp', args);
      job.child = child;
      let settled = false;
      let stderrOutput = '';
      // Cap a single build attempt at 9 minutes so a stuck download does
      // not hold the browser's download entry open forever.
      const cap = setTimeout(() => {
        if (!settled) {
          try { if (!child.killed) child.kill('SIGKILL'); } catch { /* already dead */ }
          done(false);
        }
      }, 9 * 60 * 1000);
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        resolve(ok);
      };
      const parseProgress = (text: string) => {
        // yt-dlp writes its [download] lines to stdout (verified
        // 2026-11-21: 31 lines to stdout, 0 to stderr). Parse both to
        // be safe.
        const m = text.match(/\[download\]\s+([\d.]+)% of\s+([\d.]+[KMGT]iB)?/i);
        if (m) {
          this.updateProgress(job.id, {
            status: 'downloading',
            percent: parseFloat(m[1]),
            total: m[2] || job.progress.total,
          });
        }
      };
      child.stdout.on('data', (data: Buffer) => parseProgress(data.toString()));
      child.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        parseProgress(output);
      });
      child.on('close', (code) => {
        if (settled) return; // already resolved (e.g. browser closed first)
        if (code === 0) done(true);
        else {
          console.warn(`[FlowFetch] disk-build ${attempt.name} exited ${code} for job ${job.id}:`, stderrOutput.slice(-300));
          done(false);
        }
      });
      child.on('error', () => done(false));
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
