const BACKEND_DIRECT =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'https://flowfetch-backend-47ft.onrender.com';

const API_BASE =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'https://flowfetch-backend-47ft.onrender.com';

// v13.6: the backend runs on Render's free tier, which sleeps when idle
// and can answer 502/503/504 (or fail to respond at all) while it wakes
// up. A raw fetch failure or a non-JSON error page used to surface as a
// cryptic error; instead, tell the user the server is waking up and to
// try again in a moment.
const SERVER_WAKING_UP =
  'The server is waking up (free server sleeps when idle). Please wait a moment and try again.';

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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  } catch {
    throw new Error(SERVER_WAKING_UP);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error(SERVER_WAKING_UP);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(SERVER_WAKING_UP);
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to analyze URL');
  }
  return data.data;
};

export const startDownload = async (
  analysisId: string,
  formatId: string
): Promise<{ jobId: string; streamMode: string }> => {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysisId, formatId })
    });
  } catch {
    throw new Error(SERVER_WAKING_UP);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error(SERVER_WAKING_UP);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(SERVER_WAKING_UP);
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to start download');
  }
  return { jobId: data.jobId, streamMode: data.streamMode };
};

export const getDownloadUrl = (jobId: string) => {
  return `${BACKEND_DIRECT}/api/download/${jobId}`;
};


export const getProgressUrl = (jobId: string) => {
  return `${API_BASE}/api/progress/${jobId}`;
};
