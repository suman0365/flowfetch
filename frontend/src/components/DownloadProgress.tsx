import type { JobProgressEvent } from "../types";
import { formatBytes, formatEta, formatSpeed } from "../utils/format";

interface Props {
  progress: JobProgressEvent;
  error: string | null;
  onRetry: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Preparing download…",
  preparing: "Preparing download…",
  downloading: "Downloading",
  merging: "Merging audio + video…",
  finalizing: "Finalizing…",
};

export default function DownloadProgress({ progress, error, onRetry }: Props) {
  if (progress.status === "failed" || error) {
    return (
      <div className="card download-progress download-progress-error">
        <h3>Download failed</h3>
        <p role="alert">{error ?? progress.error?.message ?? "Something went wrong. Please try again."}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const determinate = progress.status === "downloading" && progress.percent != null;
  const size = formatBytes(progress.totalBytes);
  const speed = formatSpeed(progress.speedBytesPerSec);
  const eta = formatEta(progress.etaSeconds);

  return (
    <div className="card download-progress" aria-live="polite">
      <h3>{STATUS_LABEL[progress.status] ?? "Working…"}</h3>

      <div
        className={`progress-track${determinate ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-valuenow={determinate ? Math.round(progress.percent!) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={determinate ? { width: `${progress.percent}%` } : undefined} />
      </div>

      <div className="progress-stats mono">
        {determinate && <span>{Math.round(progress.percent!)}%</span>}
        {size && <span>{size}</span>}
        {speed && <span>{speed}</span>}
        {eta && <span>ETA {eta}</span>}
      </div>
    </div>
  );
}
