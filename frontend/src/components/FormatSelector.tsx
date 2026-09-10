import type { NormalizedFormat } from '../utils/api';
import { Download, Film, Music, MonitorPlay, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface FormatSelectorProps {
  formats: NormalizedFormat[];
  onDownload: (formatId: string) => void;
  onFormatSelect: (formatId: string) => void;
  isDownloading: boolean;
  isPrefetching: boolean;
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return 'Size unavailable';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export function FormatSelector({
  formats,
  onDownload,
  onFormatSelect,
  isDownloading,
  isPrefetching,
}: FormatSelectorProps) {
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  const videoAndAudio = formats.filter(f => f.type === 'video+audio');
  const videoOnly = formats.filter(f => f.type === 'video');
  const audioOnly = formats.filter(f => f.type === 'audio');

  const renderFormatList = (list: NormalizedFormat[], title: string, icon: React.ReactNode) => {
    if (list.length === 0) return null;
    return (
      <div className="format-category">
        <h3 className="format-category-title flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <div className="format-grid">
          {list.map((f, i) => {
            const isSelected = selectedFormat === f.id;
            const isRecommended = title === 'Video + Audio' && i === 0;

            return (
              <div
                key={f.id}
                className={`format-card ${isSelected ? 'selected' : ''} ${isRecommended ? 'recommended' : ''}`}
                onClick={() => {
                  setSelectedFormat(f.id);
                  onFormatSelect(f.id); // triggers eager job pre-creation
                }}
              >
                {isRecommended && <span className="recommended-badge">Recommended</span>}
                <div className="format-info">
                  <span className="format-res">{f.resolution}</span>
                  <span className="format-ext">{f.ext.toUpperCase()}</span>
                </div>
                <div className="format-meta text-muted mt-2">
                  <span>{formatBytes(f.filesize)}</span>
                  {f.fps ? <span> • {f.fps}fps</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Determine button label and disabled state
  const busy = isDownloading || isPrefetching;
  const buttonLabel = isDownloading
    ? 'Starting Download...'
    : isPrefetching
    ? 'Preparing...'
    : 'Download';

  return (
    <div className="format-selector mt-8">
      <h2 className="text-center mb-8 text-2xl font-semibold">Choose your format</h2>

      {renderFormatList(videoAndAudio, 'Video + Audio', <Film size={20} />)}
      {renderFormatList(audioOnly, 'Audio Only', <Music size={20} />)}
      {renderFormatList(videoOnly, 'Video Only', <MonitorPlay size={20} />)}

      <div className="download-action text-center mt-8">
        <button
          className="btn btn-primary download-btn"
          disabled={!selectedFormat || busy}
          onClick={() => selectedFormat && onDownload(selectedFormat)}
        >
          {busy
            ? <Loader2 size={20} className="mr-2 animate-spin" />
            : <Download size={20} className="mr-2" />
          }
          {buttonLabel}
        </button>
        {isPrefetching && (
          <p className="text-muted text-sm mt-3">
            Registering format with server...
          </p>
        )}
      </div>
    </div>
  );
}
