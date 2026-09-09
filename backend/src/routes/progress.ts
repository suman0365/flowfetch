import { Router } from "express";
import { getJob } from "../services/jobStore.js";
import { jobEvents } from "../services/jobEvents.js";
import { validateJobIdParam } from "../middleware/validation.js";
import { FlowFetchError, type DownloadJob } from "../types/index.js";

export const progressRouter = Router();

function toPayload(job: DownloadJob) {
  return {
    jobId: job.id,
    status: job.progress.status,
    percent: job.progress.percent,
    downloadedBytes: job.progress.downloadedBytes,
    totalBytes: job.progress.totalBytes,
    speedBytesPerSec: job.progress.speedBytesPerSec,
    etaSeconds: job.progress.etaSeconds,
    message: job.progress.message,
    error: job.error,
    result:
      job.result && job.progress.status === "complete"
        ? {
            filename: job.result.filename,
            fileSizeBytes: job.result.fileSizeBytes,
            downloadUrl: `/api/download/${job.id}`,
          }
        : null,
  };
}

// GET /api/progress/:jobId — Server-Sent Events stream of job progress.
// Chosen over polling/WebSocket because it's a one-directional stream that
// works over plain HTTP with automatic browser reconnect.
progressRouter.get("/progress/:jobId", validateJobIdParam(), (req, res, next) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    next(new FlowFetchError("NOT_FOUND", "This job couldn't be found.", 404));
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (data: ReturnType<typeof toPayload>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send(toPayload(job));

  const listener = (updatedJob: DownloadJob) => {
    send(toPayload(updatedJob));
    if (updatedJob.progress.status === "complete" || updatedJob.progress.status === "failed") {
      cleanup();
    }
  };

  jobEvents.on(job.id, listener);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  function cleanup() {
    clearInterval(heartbeat);
    jobEvents.off(job.id, listener);
    res.end();
  }

  req.on("close", cleanup);
});
