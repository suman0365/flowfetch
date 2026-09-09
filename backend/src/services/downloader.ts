import path from "node:path";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { config, paths } from "../config/index.js";
import { downloadFormat } from "./ytdlp.js";
import { createJob, getJob, updateProgress, completeJob, failJob } from "./jobStore.js";
import { emitJobUpdate } from "./jobEvents.js";
import { FlowFetchError, type DownloadJob } from "../types/index.js";
import { logger } from "../utils/logger.js";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/opus",
  ogg: "audio/ogg",
};

function sanitizeSegment(segment: string): string {
  // Strip anything that isn't a safe filename character, and collapse
  // whitespace, so nothing from the video title can traverse or inject paths.
  return segment
    .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "flowfetch-download";
}

export function startDownloadJob(url: string, formatId: string): DownloadJob {
  const id = nanoid(12);
  const now = Date.now();

  const job: DownloadJob = {
    id,
    url,
    formatId,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    progress: {
      status: "queued",
      percent: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSec: null,
      etaSeconds: null,
      message: "Preparing download…",
    },
    error: null,
    result: null,
  };

  createJob(job);
  runJob(job).catch((err) => {
    logger.error("Unhandled download job failure", { jobId: id, error: (err as Error).message });
  });

  return job;
}

async function runJob(job: DownloadJob): Promise<void> {
  const jobDir = path.join(paths.filesDir, job.id);

  try {
    await fs.mkdir(jobDir, { recursive: true });

    updateProgress(job.id, { status: "preparing", message: "Preparing download…" });
    emitJobUpdate(getJob(job.id)!);

    const outputTemplate = path.join(jobDir, "%(title).100B.%(ext)s");

    const { outputPath } = await downloadFormat(job.url, job.formatId, outputTemplate, (event) => {
      const message =
        event.status === "merging"
          ? "Merging audio + video…"
          : event.percent != null
          ? `Downloading ${event.percent.toFixed(0)}%`
          : "Downloading…";

      updateProgress(job.id, {
        status: event.status,
        percent: event.percent,
        totalBytes: event.totalBytes,
        speedBytesPerSec: event.speedBytesPerSec,
        etaSeconds: event.etaSeconds,
        message,
      });
      const current = getJob(job.id);
      if (current) emitJobUpdate(current);
    });

    updateProgress(job.id, { status: "finalizing", message: "Finalizing…" });
    emitJobUpdate(getJob(job.id)!);

    const stat = await fs.stat(outputPath);
    if (stat.size > config.maxFileSize) {
      await fs.rm(jobDir, { recursive: true, force: true });
      throw new FlowFetchError(
        "FILE_TOO_LARGE",
        "The resulting file exceeds the size FlowFetch allows.",
        413
      );
    }

    const ext = path.extname(outputPath).replace(".", "").toLowerCase();
    const filename = sanitizeSegment(path.basename(outputPath, path.extname(outputPath))) + "." + (ext || "mp4");

    completeJob(
      job.id,
      {
        filename,
        filePath: outputPath,
        fileSizeBytes: stat.size,
        mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream",
      },
      Date.now() + config.fileRetentionMs
    );
    emitJobUpdate(getJob(job.id)!);
  } catch (err) {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    const ffError =
      err instanceof FlowFetchError
        ? err
        : new FlowFetchError("SERVER_ERROR", "Something went wrong while downloading.", 500);
    logger.error("Download job failed", { jobId: job.id, code: ffError.code });
    failJob(job.id, ffError.code, ffError.message);
    emitJobUpdate(getJob(job.id)!);
  }
}
