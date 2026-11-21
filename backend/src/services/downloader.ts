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
 *                them), then streamed to the browser. v13.3: the build
 *                runs BEFORE the response headers go out, so the headers
 *                carry the EXACT Content-Length of the finished file and
 *                Chrome shows a true 0–100% bar in Downloads (Suman,
 *                2026-11-21: instant is not required, but the download
 *                must happen in the browser with a percentage like a
 *                normal browser download). One tap, no second click —
 *                the browser is still waiting on the same response the
 *                tap opened; the entry appears when the build finishes.
 *                Trade-off: nothing shows in Downloads during the build
 *                (30s–3min), and a very long build can outlast the
 *                connection — but the build survives on the server
 *                (v13.2) and a retry tap streams the finished file.
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
 *
 * v13.2 (2026-11-21): NO SIZE LIMIT. The old 2 GB MAX_FILE_SIZE was dead
 * config — grep verified nothing in the code ever read it, so no size
 * cap was ever actually enforced. The real caps for big files were the
 * 9-minute per-attempt kill and the build being cancelled when the
 * browser disconnected; both are lifted here (50-minute cap, build
 * survives a dropped connection). Suman's rule: any size at 0 cost,
 * slow is fine. The only remaining limits are the server's disk space
 * and how long a build/connection can survive.
 *
 * v13.3 (2026-11-21): BUILD FIRST, headers second, for disk_build.
 * The old headers-first flow could not set Content-Length (size
 * unknown until the merge finishes), so Chrome showed only
 * "Downloading..." with no percentage — Suman's phone showed exactly
 * that on 2026-11-21. Now the size is the built file's real size.
 * A failed build now returns a real error status instead of a
 * silent 0-byte file, because no headers have been sent yet.
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
  // Shared response setup — sends the attachment headers. For 'direct'
  // they go out first (the download entry appears in Chrome instantly).
  // For 'disk_build' (v13.3) they go out AFTER the build, carrying the
  // exact Content-Length of the finished file, so Chrome shows a real
  // 0–100% bar. Either way the download lives in the browser from tap
  // one — no site-side "Preparing..." phase, no second click.
  // -----------------------------------------------------------------------

  private sendDownloadHeaders(job: Job, res: any, knownSize: boolean, exactSize?: number): void {
    const { format } = job;
    const safeTitle = sanitizeFilename(job.title);
    const resolutionSuffix = format.resolution ? ` - ${format.resolution}` : '';
    const safeFilename = `${safeTitle}${resolutionSuffix}.${format.ext}`;
    // Full title (Tamil/emoji kept) for the RFC 5987 filename* value only.
    const fullFilename = `${job.title.replace(/[<>:\"/\\|?*\x00-\x1F]/g, '').trim() || 'video'}${resolutionSuffix}.${format.ext}`;

    res.setHeader('Content-Type', contentTypeFor(format.ext));
    // Plain filename="..." must be ASCII-only (Node rejects non-Latin1
    // header bytes); the RFC 5987 filename* carries the real title.
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(fullFilename)}`);
    res.setHeader('Cache-Control', 'no-store');
    // Content-Length: for a disk build (v13.3) the caller passes the
    // built file's exact size — that is what makes Chrome show a real
    // 0–100%. For a single stream the size comes from the format
    // metadata. Never send a guessed Content-Length — a wrong value
    // truncates or hangs the file.
    if (exactSize && exactSize > 0) {
      res.setHeader('Content-Length', exactSize);
    } else if (knownSize && format.filesize && format.filesize > 0) {
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
  // v13.3: the merged file is built on disk FIRST, then the headers go
  // out with the exact Content-Length, then the file streams to the
  // browser. One tap, no second click, no site-side Preparing phase —
  // and Chrome shows a real 0–100% bar.
  // -----------------------------------------------------------------------

  async startDiskBuildStream(id: string, res: any): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'Job not found or expired' });
      return;
    }
    this.markStarted(job);

    // v13.3: BUILD FIRST, headers second. The size is only known once
    // the merge finishes, so the headers (with the exact Content-Length
    // of the built file) go out AFTER the build — that is what makes
    // Chrome show a true 0–100% bar. One tap, no second click: the
    // browser is still waiting on the same response the tap opened.
    // Trade-off: nothing shows in Downloads during the build, and a
    // very long build can outlast the connection — but the build
    // survives on the server (v13.2) and a retry tap streams the
    // finished file straight away.

    // If the browser goes away mid-build (user cancelled, connection
    // dropped on a long build), do NOT kill the build: let it finish on
    // the server so a retry tap can stream the finished file instead of
    // rebuilding from scratch. The buildPromise is cached on the job,
    // so a later GET for the same job reuses it. (Suman's rule,
    // 2026-11-21: no size limit, slow is fine — a big file's build can
    // outlast the browser connection.)
    let cancelled = false;
    res.once('close', () => {
      cancelled = true;
    });

    const result = await this.runDiskBuild(job);
    if (cancelled || res.destroyed || res.writableEnded) return;

    if (!result.ok || !result.filePath || !fs.existsSync(result.filePath)) {
      this.updateProgress(id, { status: 'failed', error: 'DOWNLOAD_FAILED: Download process failed.' });
      // No headers have been sent yet, so a real error status is
      // possible now — the browser shows a failed download instead of
      // a silent 0-byte file.
      if (!res.headersSent) res.status(502).json({ success: false, error: 'Download failed. Please try again.' });
      else if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }

    // Exact size of the built file → real 0–100% in the browser.
    job.filePath = result.filePath;
    const size = fs.statSync(result.filePath).size;
    this.sendDownloadHeaders(job, res, false, size);
    this.updateProgress(id, { status: 'downloading' });

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
      // Cap a single build attempt at 50 minutes. A big file (3 GB+) at
      // the free tier's ~2.4 MB/s takes ~20-35 min to download; the old
      // 9-minute cap would have killed it mid-way. 50 min stays under
      // the 1-hour downloadTimeout the cleanup job uses, so a finished
      // file is never deleted before the user can fetch it. Suman's
      // rule (2026-11-21): no size limit, slow is fine.
      const cap = setTimeout(() => {
        if (!settled) {
          try { if (!child.killed) child.kill('SIGKILL'); } catch { /* already dead */ }
          done(false);
        }
      }, 50 * 60 * 1000);
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
