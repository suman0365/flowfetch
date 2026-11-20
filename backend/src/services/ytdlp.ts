import { spawn } from 'child_process';
import { attemptsFor, baseArgs, YtAttempt } from './ytdlpArgs';

export interface YtDlpFormat {
  format_id: string;
  ext: string;
  resolution?: string;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  vcodec?: string;
  acodec?: string;
  tbr?: number;
  height?: number;
  width?: number;
  format_note?: string;
}

export interface YtDlpMetadata {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  extractor: string;
  formats: YtDlpFormat[];
  description?: string;
  age_limit?: number;
  tags?: string[];
  categories?: string[];
}

function runOnce(url: string, attempt: YtAttempt, timeoutMs: number): Promise<YtDlpMetadata> {
  return new Promise((resolve, reject) => {
    const args = [...baseArgs(attempt), '--dump-json', url];
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutData = '';
    let stderrData = '';
    child.stdout.on('data', (data) => { stdoutData += data.toString(); });
    child.stderr.on('data', (data) => { stderrData += data.toString(); });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Process timeout: yt-dlp took too long to respond.'));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`yt-dlp failed: ${stderrData}`));
      try {
        resolve(JSON.parse(stdoutData) as YtDlpMetadata);
      } catch {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
}

export const getMetadata = async (url: string): Promise<YtDlpMetadata> => {
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided');
  }
  const attempts = attemptsFor(url);
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      console.log(`[FlowFetch] analyze attempt: ${attempt.name} for ${url}`);
      const metadata = await runOnce(url, attempt, 30000);
      if (metadata.formats && metadata.formats.length > 0) return metadata;
      throw new Error('yt-dlp returned no formats');
    } catch (err: any) {
      lastError = err;
      console.warn(`[FlowFetch] analyze attempt ${attempt.name} failed: ${String(err.message).slice(0, 300)}`);
      continue;
    }
  }
  throw lastError ?? new Error('yt-dlp failed: unknown error');
};
