import type { Metadata } from '../utils/api';
import { User } from 'lucide-react';

interface VideoInfoProps {
  metadata: Metadata;
  onReset: () => void;
}

const formatDuration = (seconds: number) => {
  if (!seconds) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export function VideoInfo({ metadata, onReset }: VideoInfoProps) {
  return (
    <div className="card video-info-card">
      <div className="video-info-content">
        <div className="video-thumbnail-container">
          <img src={metadata.thumbnail} alt={metadata.title} className="video-thumbnail" />
          <span className="video-duration">{formatDuration(metadata.duration)}</span>
        </div>
        
        <div className="video-details">
          <h2 className="video-title">{metadata.title}</h2>
          <div className="video-meta flex items-center gap-4 text-muted mt-2">
            <span className="flex items-center gap-1">
              <User size={16} />
              {metadata.uploader || 'Unknown'}
            </span>
            <span className="platform-badge">{metadata.site}</span>
          </div>
          
          <button onClick={onReset} className="btn btn-outline reset-btn mt-4">
            Analyze another URL
          </button>
        </div>
      </div>
    </div>
  );
}
