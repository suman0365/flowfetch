import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { assertSafeMediaUrl } from "../utils/urlValidator.js";
import { startDownloadJob } from "../services/downloader.js";
import { getJob, findActiveJob } from "../services/jobStore.js";
import { validateDownloadBody, validateJobIdParam } from "../middleware/validation.js";
import { downloadLimiter } from "../middleware/rateLimit.js";
import { FlowFetchError } from "../types/index.js";
import { paths } from "../config/index.js";
import { logger } from "../utils/logger.js";

export const downloadRouter = Router();

// POST /api/download — create (or re-attach to) a download job.
downloadRouter.post("/download", downloadLimiter, validateDownloadBody(), async (req, res, next) => {
  try {
    const url = await assertSafeMediaUrl(req.body.url);
    const formatId: string = req.body.formatId;

    const existing = findActiveJob(url.toString(), formatId);
    if (existing) {
      res.json({ success: true, data: { jobId: existing.id, status: existing.progress.status } });
      return;
    }

    const job = startDownloadJob(url.toString(), formatId);
    res.status(202).json({ success: true, data: { jobId: job.id, status: job.progress.status } });
  } catch (err) {
    next(err);
  }
});

// GET /api/download/:jobId — securely stream the completed file. The job id
// is an opaque nanoid; no filesystem path is ever accepted from the client.
downloadRouter.get("/download/:jobId", validateJobIdParam(), (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job) {
      throw new FlowFetchError("NOT_FOUND", "This download couldn't be found or has expired.", 404);
    }
    if (job.progress.status !== "complete" || !job.result) {
      throw new FlowFetchError("NOT_READY", "This download isn't ready yet.", 409);
    }

    // Defense in depth: confirm the resolved file actually lives under the
    // managed files directory before ever streaming it back.
    const resolved = path.resolve(job.result.filePath);
    if (!resolved.startsWith(path.resolve(paths.filesDir))) {
      logger.error("Path traversal attempt blocked", { jobId: job.id });
      throw new FlowFetchError("SERVER_ERROR", "Something went wrong on our end.", 500);
    }

    res.setHeader("Content-Type", job.result.mimeType);
    res.setHeader("Content-Length", String(job.result.fileSizeBytes));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${job.result.filename.replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(resolved);
    stream.on("error", (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});
