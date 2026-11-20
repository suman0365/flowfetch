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
    const args = [...baseArgs(attempt, url), '--dump-json', url];
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

export const getMetadata = async (
  url: string,
  onStage?: (stage: string, detail?: string) => void
): Promise<YtDlpMetadata> => {
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided');
  }
  const attempts = attemptsFor(url);
  let lastError: Error | null = null;
  let best: YtDlpMetadata | null = null;
  let bestHeights = -1;
  let tried = 0;
  for (const attempt of attempts) {
    if (best && (bestHeights >= 4 || tried >= 3)) break;
    tried++;
    try {
      console.log(`[FlowFetch] analyze attempt: ${attempt.name} for ${url}`);
      onStage?.('client', attempt.name);
      const metadata = await runOnce(url, attempt, 30000);
      if (metadata.formats && metadata.formats.length > 0) {
        const heights = new Set(
          metadata.formats.filter((f) => f.height && f.vcodec !== 'none').map((f) => f.height)
        ).size;
        if (heights > bestHeights) {
          best = metadata;
          bestHeights = heights;
        }
        if (bestHeights >= 4 && best) return best;
        continue;
      }
      throw new Error('yt-dlp returned no formats');
    } catch (err: any) {
      lastError = err;
      console.warn(`[FlowFetch] analyze attempt ${attempt.name} failed: ${String(err.message).slice(0, 300)}`);
      continue;
    }
  }
  if (best) return best;
  throw lastError ?? new Error('yt-dlp failed: unknown error');
};
