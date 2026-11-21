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

// Quality label from the resolution, so the list reads like a real
// downloader instead of a wall of numbers.
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
}: FormatSelectorProps) {
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  const videoAndAudio = formats.filter(f => f.type === 'video+audio');
  const videoOnly = formats.filter(f => f.type === 'video');
  const audioOnly = formats.filter(f => f.type === 'audio');

  // The 720p combined row is the sensible default for most phones.
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
                onClick={() => {
                  setSelectedFormat(f.id);
                  onFormatSelect(f.id);
                }}
                className={`format-row ${isSelected ? 'selected' : ''} ${isBest ? 'best' : ''}`}
                aria-pressed={isSelected}
              >
                <span className="format-info">
                  <span className="format-label">
                    {f.type === 'audio' ? 'Audio only' : `${qualityTag(f)} · ${f.resolution}`}
                    {f.type === 'video+audio' && f.fps ? ` · ${f.fps}fps` : ''}
                    {isBest && <span className="best-badge">Best for phone</span>}
                  </span>
                  <span className="format-sub">
                    {formatBytes(f.filesize)}
                    {f.note ? ` · ${f.note}` : ''}
                  </span>
                </span>
                <span className="format-check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const handleDownloadClick = () => {
    if (!selectedFormat) return;
    onDownload(selectedFormat);
  };

  // v13.6: the button is DISABLED while a format is registering
  // (isPrefetching). Before this, the button stayed enabled and a tap
  // before the job was ready fell through to the fallback path, which
  // only registered the job and showed "Ready! Click Download once
  // more" — so tap 1 silently did nothing and tap 2 was needed.
  // Now one tap always fires the download, because the button only
  // becomes tappable once the job is ready. If the prefetch fails
  // (backend down), the button re-enables and the tap retries.
  const buttonLabel = isDownloading
    ? 'Opening download…'
    : isPrefetching
      ? 'Preparing…'
      : 'Download file';

  return (
    <div className="format-selector">
      <div className="format-groups">
        {renderFormatList(videoAndAudio, 'Video + Audio', <MonitorPlay className="h-4 w-4" />)}
        {renderFormatList(videoOnly, 'Video only', <Film className="h-4 w-4" />)}
        {renderFormatList(audioOnly, 'Audio only', <Music className="h-4 w-4" />)}
      </div>
      <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 py-3 backdrop-blur">
        <button
          type="button"
          onClick={handleDownloadClick}
          disabled={!selectedFormat || isDownloading || isPrefetching}
          className="download-btn"
        >
          {isDownloading || isPrefetching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          {buttonLabel}
        </button>
        {isPrefetching && !isDownloading && <p className="mt-1 text-xs text-muted-foreground">Preparing your download — please wait a moment. The free server can take ~30 seconds to wake up.</p>}
        {isDownloading && <p className="mt-1 text-xs text-muted-foreground">Your video is opening in a new tab — tap the three dots (⋮) in the player to download it.</p>}
      </div>
    </div>
  );
}
