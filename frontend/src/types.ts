export interface FormatOption {
  formatId: string;
  container: string;
  kind: "video+audio" | "video-only" | "audio-only";
  resolution: string | null;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  abr: number | null;
  vbr: number | null;
  filesizeBytes: number | null;
  filesizeApprox: boolean;
  label: string;
  recommended: boolean;
}

export interface MediaInfo {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  site: string;
  description: string | null;
  formats: FormatOption[];
  sourceUrl: string;
}

export type JobStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "merging"
  | "finalizing"
  | "complete"
  | "failed";

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  percent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  message: string;
  error: { code: string; message: string } | null;
  result: { filename: string; fileSizeBytes: number; downloadUrl: string } | null;
}

export interface ApiError {
  code: string;
  message: string;
}
