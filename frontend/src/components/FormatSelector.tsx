import type { NormalizedFormat } from '../utils/api';
import { Download, Film, Music, MonitorPlay, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface FormatSelectorProps {
  formats: NormalizedFormat[];
  onDownload: (formatId: string) => void;
  onFormatSelect: (formatId: string) => void;
  isDownloading: boolean;
  isPrefetching: boolean;
  preparingPercent?: number | null;
  // Shown right above the Download button: the file-ready / failure
  // banner must live HERE, next to the button, not only as a toast at
  // the top of the page (2026-11-21: Suman never saw the top toast
  // while scrolled down here, so his ready file never got downloaded).
  downloadReady?: boolean;
downloadFailMsg?: string | null;}

const formatBytes = (bytes?: number) => {
  if (!bytes) return 'Size unavailable';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const qualityTag = (f: NormalizedFormat) => {
  if (f.type === 'audio') return 'Audio';
  const h = parseInt(f.resolution.replace('p', '')) || 0;
  if (h >= 2160) return '4K';
  if (h >= 1080) return 'Full HD';
  if (h >= 720) return 'HD';
  return 'SD';
};

export function FormatSelector({
  formats,
  onDownload,
  onFormatSelect,
  isDownloading,
  isPrefetching,
  preparingPercent,
  downloadReady,
  downloadFailMsg,
}: FormatSelectorProps) {
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  const videoAndAudio = formats.filter(f => f.type === 'video+audio');
  const videoOnly = formats.filter(f => f.type === 'video');
  const audioOnly = formats.filter(f => f.type === 'audio');

  const bestRowId = videoAndAudio.find(f => f.resolution === '720p')?.id
    ?? videoAndAudio[Math.floor(videoAndAudio.length / 2)]?.id;

  const renderFormatList = (list: NormalizedFormat[], title: string, icon: React.ReactNode) => {
    if (list.length === 0) return null;
    return (
      <div className="format-category">
        <h3 className="format-category-title flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <p className="format-count">
          {list.length} {list.length === 1 ? 'option' : 'options'}
        </p>
        <div className="format-list">
          {list.map((f) => {
            const isSelected = selectedFormat === f.id;
            const isBest = f.id === bestRowId;

            return (
              <button
                key={f.id}
                type="button"
                className={`format-row ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedFormat(f.id);
                  onFormatSelect(f.id);
                }}
              >
                <span className="format-radio" />
                <span className="format-res">{f.resolution}</span>
                <span className="quality-tag">{qualityTag(f)}</span>
                {isBest && <span className="best-tag">Best for most phones</span>}
                <span className="format-ext">{f.ext.toUpperCase()}</span>
                <span className="format-size">
                  {formatBytes(f.filesize)}
                  {f.fps ? ` · ${f.fps}fps` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const buttonLabel = downloadReady
  ? 'Download your file'
    : isDownloading && preparingPercent != null
  ? `Preparing... ${preparingPercent}%`
    : isDownloading
  ? 'Starting Download...'
    : isPrefetching
  ? 'Preparing...'
    : 'Download file';

  return (
    <div className="format-selector mt-8">
      <h2 className="text-center mb-8 text-2xl font-semibold">Choose a quality</h2>

      {renderFormatList(videoAndAudio, 'Video + Audio', <Film size={20} />)}
      {renderFormatList(audioOnly, 'Audio Only', <Music size={20} />)}
      {renderFormatList(videoOnly, 'Video Only', <MonitorPlay size={20} />)}

      <div className="download-action text-center mt-8">
        {downloadReady && (
      <div className="toast-ok" role="status">
      Your file is ready — tap Download file to save it to your phone.
        </div>
    )}
        {downloadFailMsg && (
      <div className="toast-err" role="alert">
        {downloadFailMsg}
        </div>
    )}
        <button
          className="btn btn-primary download-btn"
          disabled={!selectedFormat || isDownloading}
          onClick={() => selectedFormat && onDownload(selectedFormat)}
        >
          {(isDownloading || isPrefetching)
            ? <Loader2 size={20} className="mr-2 animate-spin" />
            : <Download size={20} className="mr-2" />
          }
          {buttonLabel}
        </button>
        {isPrefetching && (
          <p className="text-muted text-sm mt-3">
            Registering format with server... First tap after a while can take ~30 seconds — the free server wakes up. You can tap Download file anyway.
          </p>
        )}
        {isDownloading && preparingPercent != null && (
          <p className="text-muted text-sm mt-3">
            Building your file on the server: {preparingPercent}% — please wait, the button frees up when it is ready.
          </p>
        )}
        {isDownloading && preparingPercent == null && (
          <p className="text-muted text-sm mt-3">
            Preparing your file on the server... tap another format to switch, or wait for it to be ready.
          </p>
        )}
      </div>
    </div>
  );
}
