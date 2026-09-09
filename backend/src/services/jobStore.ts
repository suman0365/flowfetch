import type { DownloadJob, JobProgress } from "../types/index.js";

const jobs = new Map<string, DownloadJob>();

// A single in-flight job per (url, formatId) pair, so a double-click or a
// second browser tab can't spawn duplicate yt-dlp processes for the same work.
const activeKeys = new Map<string, string>(); // "url::formatId" -> jobId

function activeKey(url: string, formatId: string): string {
  return `${url}::${formatId}`;
}

export function findActiveJob(url: string, formatId: string): DownloadJob | null {
  const jobId = activeKeys.get(activeKey(url, formatId));
  if (!jobId) return null;
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.progress.status === "complete" || job.progress.status === "failed") return null;
  return job;
}

export function createJob(job: DownloadJob): void {
  jobs.set(job.id, job);
  activeKeys.set(activeKey(job.url, job.formatId), job.id);
}

export function getJob(id: string): DownloadJob | undefined {
  return jobs.get(id);
}

export function updateProgress(id: string, progress: Partial<JobProgress>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = { ...job.progress, ...progress };
  job.updatedAt = Date.now();
}

export function completeJob(
  id: string,
  result: DownloadJob["result"],
  expiresAt: number
): void {
  const job = jobs.get(id);
  if (!job) return;
  job.result = result;
  job.expiresAt = expiresAt;
  job.progress = { ...job.progress, status: "complete", percent: 100, message: "Complete" };
  job.updatedAt = Date.now();
  activeKeys.delete(activeKey(job.url, job.formatId));
}

export function failJob(id: string, code: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.error = { code, message };
  job.progress = { ...job.progress, status: "failed", message };
  job.updatedAt = Date.now();
  activeKeys.delete(activeKey(job.url, job.formatId));
}

export function allJobs(): DownloadJob[] {
  return [...jobs.values()];
}

export function removeJob(id: string): void {
  const job = jobs.get(id);
  if (job) activeKeys.delete(activeKey(job.url, job.formatId));
  jobs.delete(id);
}
