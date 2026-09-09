export interface FormatOption {
  formatId: string;
  container: string; // e.g. mp4, m4a, webm
  kind: "video+audio" | "video-only" | "audio-only";
  resolution: string | null; // "1920x1080" or null for audio
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  abr: number | null; // audio bitrate kbps
  vbr: number | null; // video bitrate kbps
  filesizeBytes: number | null;
  filesizeApprox: boolean;
  label: string; // human readable, e.g. "1080p MP4"
  recommended: boolean;
}

export interface MediaInfo {
  sourceUrl: string;
  title: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  site: string;
  description: string | null;
  formats: FormatOption[];
}

export type JobStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "merging"
  | "finalizing"
  | "complete"
  | "failed";

export interface JobProgress {
  status: JobStatus;
  percent: number | null; // 0-100, null when indeterminate
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
  message: string;
}

export interface DownloadJob {
  id: string;
  url: string;
  formatId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  progress: JobProgress;
  error: { code: string; message: string } | null;
  result: {
    filename: string;
    filePath: string;
    fileSizeBytes: number;
    mimeType: string;
  } | null;
}

export class FlowFetchError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
