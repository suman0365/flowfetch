import { test } from "node:test";
import assert from "node:assert/strict";
import { createJob, findActiveJob, completeJob, failJob, getJob } from "../src/services/jobStore.js";
import type { DownloadJob } from "../src/types/index.js";

function newJob(id: string, url: string, formatId: string): DownloadJob {
  return {
    id,
    url,
    formatId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
}

test("findActiveJob returns null when nothing is running for that key", () => {
  assert.equal(findActiveJob("https://example.com/a", "137"), null);
});

test("createJob registers the job as active for its url+format pair", () => {
  createJob(newJob("job1", "https://example.com/a", "137"));
  const active = findActiveJob("https://example.com/a", "137");
  assert.ok(active);
  assert.equal(active!.id, "job1");
});

test("completeJob clears the active slot so a new job can be started", () => {
  createJob(newJob("job2", "https://example.com/b", "140"));
  completeJob(
    "job2",
    { filename: "clip.mp4", filePath: "/tmp/clip.mp4", fileSizeBytes: 100, mimeType: "video/mp4" },
    Date.now() + 1000
  );
  assert.equal(findActiveJob("https://example.com/b", "140"), null);
  assert.equal(getJob("job2")?.progress.status, "complete");
});

test("failJob records the error and clears the active slot", () => {
  createJob(newJob("job3", "https://example.com/c", "bestaudio"));
  failJob("job3", "UNSUPPORTED_SITE", "FlowFetch doesn't support this website yet.");
  assert.equal(findActiveJob("https://example.com/c", "bestaudio"), null);
  assert.equal(getJob("job3")?.progress.status, "failed");
  assert.equal(getJob("job3")?.error?.code, "UNSUPPORTED_SITE");
});
