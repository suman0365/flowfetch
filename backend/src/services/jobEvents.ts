import { EventEmitter } from "node:events";
import type { DownloadJob } from "../types/index.js";

// One emitter shared by all jobs; SSE handlers subscribe filtered by jobId.
// Keeps the progress route decoupled from the download service.
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

export function emitJobUpdate(job: DownloadJob): void {
  jobEvents.emit(job.id, job);
}
