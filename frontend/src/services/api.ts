import type { ApiError, JobProgressEvent, MediaInfo } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export class ApiRequestError extends Error {
  code: string;
  constructor(err: ApiError) {
    super(err.message);
    this.code = err.code;
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ApiRequestError({ code: "SERVER_ERROR", message: "Something went wrong on our end." });
  }
  if (!res.ok || !body.success) {
    throw new ApiRequestError(body.error ?? { code: "SERVER_ERROR", message: "Something went wrong." });
  }
  return body.data as T;
}

export function analyzeUrl(url: string): Promise<MediaInfo> {
  return fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).then((res) => parseJsonResponse<MediaInfo>(res));
}

export function createDownload(
  url: string,
  formatId: string
): Promise<{ jobId: string; status: string }> {
  return fetch(`${API_URL}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, formatId }),
  }).then((res) => parseJsonResponse<{ jobId: string; status: string }>(res));
}

/**
 * Subscribes to a job's Server-Sent Events progress stream. Returns an
 * unsubscribe function so callers can clean up on unmount.
 */
export function subscribeToProgress(
  jobId: string,
  onUpdate: (event: JobProgressEvent) => void,
  onError: () => void
): () => void {
  const source = new EventSource(`${API_URL}/progress/${jobId}`);

  source.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data) as JobProgressEvent;
      onUpdate(data);
      if (data.status === "complete" || data.status === "failed") {
        source.close();
      }
    } catch {
      // Ignore malformed keep-alive frames.
    }
  };

  source.onerror = () => {
    onError();
    source.close();
  };

  return () => source.close();
}

export function fileDownloadUrl(downloadUrl: string): string {
  return `${API_URL.replace(/\/api$/, "")}${downloadUrl}`;
}
