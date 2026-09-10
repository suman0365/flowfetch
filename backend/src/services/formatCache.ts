import { randomUUID } from 'crypto';

export interface NormalizedFormat {
  id: string; // The virtual ID for UI (e.g. combined-137-140)
  type: 'video+audio' | 'video' | 'audio';
  resolution: string; // e.g. '1080p', '720p', 'Audio'
  ext: string;
  videoFormatId?: string;
  audioFormatId?: string;
  filesize?: number;
  fps?: number;
  note?: string;
}

export interface CachedAnalysis {
  url: string;
  title: string;
  formats: NormalizedFormat[];
  timestamp: number;
}

class FormatCacheService {
  private cache: Map<string, CachedAnalysis> = new Map();
  private TTL = 1000 * 60 * 60; // 1 hour

  save(url: string, formats: NormalizedFormat[], title: string = 'video'): string {
    const analysisId = randomUUID();
    this.cache.set(analysisId, {
      url,
      title,
      formats,
      timestamp: Date.now()
    });
    
    // Cleanup old entries occasionally
    this.cleanup();
    
    return analysisId;
  }

  get(analysisId: string): CachedAnalysis | undefined {
    return this.cache.get(analysisId);
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, data] of this.cache.entries()) {
      if (now - data.timestamp > this.TTL) {
        this.cache.delete(id);
      }
    }
  }
}

export const formatCache = new FormatCacheService();
