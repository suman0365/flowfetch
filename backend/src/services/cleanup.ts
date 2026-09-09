import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "../config/index.js";
import { allJobs, removeJob } from "./jobStore.js";
import { logger } from "../utils/logger.js";

async function sweepExpiredJobFiles(): Promise<void> {
  const now = Date.now();

  for (const job of allJobs()) {
    const isTerminal = job.progress.status === "complete" || job.progress.status === "failed";
    if (!isTerminal) continue;

    const expired = job.expiresAt !== null && job.expiresAt <= now;
    // Failed jobs with no file are safe to drop from memory after a short grace period.
    const staleFailed = job.progress.status === "failed" && now - job.updatedAt > config.fileRetentionMs;

    if (expired || staleFailed) {
      const jobDir = path.join(paths.filesDir, job.id);
      await fs.rm(jobDir, { recursive: true, force: true }).catch((err) => {
        logger.warn("Cleanup: failed to remove job directory", { jobId: job.id, error: err.message });
      });
      removeJob(job.id);
      logger.info("Cleanup: removed expired job", { jobId: job.id });
    }
  }
}

/**
 * Also sweeps orphaned directories on disk that don't correspond to any job
 * FlowFetch still knows about (e.g. after a server restart).
 */
async function sweepOrphanedDirectories(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(paths.filesDir);
  } catch {
    return;
  }

  const knownIds = new Set(allJobs().map((j) => j.id));

  for (const entry of entries) {
    if (knownIds.has(entry)) continue;
    const fullPath = path.join(paths.filesDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > config.fileRetentionMs) {
        await fs.rm(fullPath, { recursive: true, force: true });
        logger.info("Cleanup: removed orphaned directory", { path: entry });
      }
    } catch {
      // Ignore races where the entry disappeared between readdir and stat.
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startCleanupScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    sweepExpiredJobFiles().catch((err) => logger.error("Cleanup sweep failed", { error: err.message }));
    sweepOrphanedDirectories().catch((err) => logger.error("Orphan sweep failed", { error: err.message }));
  }, config.cleanupIntervalMs);
  timer.unref();
}

export function stopCleanupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
