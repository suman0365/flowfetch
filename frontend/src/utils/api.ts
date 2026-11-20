const BACKEND_DIRECT =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'https://flowfetch-backend-47ft.onrender.com';

const API_BASE =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'https://flowfetch-backend-47ft.onrender.com';

export interface NormalizedFormat {
  id: string;
  type: 'video+audio' | 'video' | 'audio';
  resolution: string;
  ext: string;
  videoFormatId?: string;
  audioFormatId?: string;
  filesize?: number;
  fps?: number;
  note?: string;
}

export interface Metadata {
  analysisId: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  site: string;
  description?: string;
  age_limit?: number;
  formats: NormalizedFormat[];
}

export const analyzeUrl = async (url: string): Promise<Metadata> => {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to analyze URL');
  }
  return data.data;
};

export const startDownload = async (
  analysisId: string,
  formatId: string
): Promise<{ jobId: string; streamMode: string }> => {
  const res = await fetch(`${API_BASE}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisId, formatId })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to start download');
  }
  return { jobId: data.jobId, streamMode: data.streamMode };
};

export const getDownloadUrl = (jobId: string) => {
  return `${BACKEND_DIRECT}/api/download/${jobId}`;
};

export const getDownloadStatus = async (jobId: string): Promise<{ status: 'ready' | 'failed' | 'processing'; filename?: string; percent?: number; downloaded?: strin;; total?: string; speed?: string; eta?: string }> => {
  const res = await fetch(`${API_BASE}/api/download/status/${jobId}`);
  return res.json();
};


export const getProgressUrl = (jobId: string) => {
  return `${API_BASE}/api/progress/${jobId}`;
};
