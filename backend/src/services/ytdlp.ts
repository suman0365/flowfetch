import { spawn } from 'child_process';
import youtubedl from 'youtube-dl-exec';
import { config } from '../config/env';

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

export const getMetadata = (url: string): Promise<YtDlpMetadata> => {
  return new Promise((resolve, reject) => {
    // Validate basic URL before passing to yt-dlp to prevent basic shell injection
    // (though spawn is safe from shell injection anyway if not using shell: true)
    try {
      new URL(url);
    } catch (e) {
      return reject(new Error('Invalid URL provided'));
    }

    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url
    ];

    const child = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Process timeout: yt-dlp took too long to respond.'));
    }, 30000); // 30s timeout for fetching metadata

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed: ${stderrData}`));
      }

      try {
        const metadata = JSON.parse(stdoutData) as YtDlpMetadata;
        resolve(metadata);
      } catch (parseError) {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
};
