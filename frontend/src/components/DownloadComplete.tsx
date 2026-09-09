import { fileDownloadUrl } from "../services/api";
import { formatBytes } from "../utils/format";

interface Props {
  result: { filename: string; fileSizeBytes: number; downloadUrl: string };
  onDownloadAnother: () => void;
}

export default function DownloadComplete({ result, onDownloadAnother }: Props) {
  const size = formatBytes(result.fileSizeBytes);

  return (
    <div className="card download-complete">
      <span className="download-complete-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h3>Your download is ready</h3>

      <dl className="download-complete-meta mono">
        <div>
          <dt>File</dt>
          <dd>{result.filename}</dd>
        </div>
        {size && (
          <div>
            <dt>Size</dt>
            <dd>{size}</dd>
          </div>
        )}
      </dl>

      <div className="download-complete-actions">
        <a className="btn btn-primary" href={fileDownloadUrl(result.downloadUrl)} download={result.filename}>
          Download file
        </a>
        <button type="button" className="btn btn-secondary" onClick={onDownloadAnother}>
          Download another
        </button>
      </div>
    </div>
  );
}
