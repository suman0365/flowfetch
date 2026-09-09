import type { MediaInfo } from "../types";
import { formatDuration } from "../utils/format";

interface Props {
  info: MediaInfo;
  onChangeUrl: () => void;
}

export default function VideoInfo({ info, onChangeUrl }: Props) {
  const duration = formatDuration(info.duration);

  return (
    <div className="card video-info">
      <div className="video-info-media">
        {info.thumbnail ? (
          <img src={info.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="video-info-media-fallback" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 32 32">
              <path d="M10 9v14l13-7z" fill="currentColor" />
            </svg>
          </div>
        )}
        {duration && <span className="video-info-duration mono">{duration}</span>}
      </div>

      <div className="video-info-body">
        <p className="eyebrow">{info.site}</p>
        <h2 className="video-info-title">{info.title}</h2>

        <dl className="video-info-meta">
          {info.uploader && (
            <div>
              <dt>Uploader</dt>
              <dd>{info.uploader}</dd>
            </div>
          )}
          <div>
            <dt>Formats available</dt>
            <dd>{info.formats.length}</dd>
          </div>
        </dl>

        {info.description && <p className="video-info-description">{info.description}</p>}

        <button type="button" className="btn btn-secondary video-info-change" onClick={onChangeUrl}>
          Analyze another URL
        </button>
      </div>
    </div>
  );
}
