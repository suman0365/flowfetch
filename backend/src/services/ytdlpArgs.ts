import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * YouTube bot-check workaround.
 * YouTube blocks yt-dlp from datacenter IPs (Render, etc.) when it uses the
 * default web player client: "Sign in to confirm you're not a bot".
 * The Android / TV-embedded player clients are served by a different
 * YouTube API path and are far less likely to be challenged, so we try
 * them first for youtube.com / youtu.be URLs, then fall back to web.
 * Non-YouTube sites are untouched (single attempt, no extractor args).
 */
export interface YtAttempt {
  name: string;
  extractorArgs?: string;
}
export const YOUTUBE_ATTEMPTS: YtAttempt[] = [
  // Default first: full formats (up to 4K) when the IP is not blocked.
  { name: 'default', extractorArgs: undefined },
  // Android next: different YouTube API path, far less likely to be
  // challenged. Trade-off: Android only returns ~360p combined formats,
  // but a working 360p download beats a blocked analyze.
  { name: 'android', extractorArgs: 'youtube:player_client=android;player_skip=webpage,configs' },
  { name: 'android-plain', extractorArgs: 'youtube:player_client=android' },
  { name: 'tv_embedded', extractorArgs: 'youtube:player_client=tv_embedded' },
  { name: 'web_safari', extractorArgs: 'youtube:player_client=web_safari;player_skip=webpage,configs' },
  { name: 'mediaconnect', extractorArgs: 'youtube:player_client=mediaconnect' },
  { name: 'web_embedded', extractorArgs: 'youtube:player_client=web_embedded' },
];

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('.youtu.be') || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'music.youtube.com' || host.endsWith('.music.youtube.com');
  } catch {
    return false;
  }
}
export function attemptsFor(url: string): YtAttempt[] {
  return isYouTubeUrl(url) ? YOUTUBE_ATTEMPTS : [{ name: 'default', extractorArgs: undefined }];
}
let cachedCookiesPath: string | null = null;
/**
 * Optional cookies support, for when even the alternate clients are
 * challenged. Set one of these Render env vars (never commit cookies):
 *   YTDLP_COOKIES_B64 - base64-encoded Netscape cookies.txt content
 *   YTDLP_COOKIES     - raw Netscape cookies.txt content
 *   COOKIES_FILE      - absolute path to an existing cookies.txt file
 * Returns ['--cookies', path] or [].
 */
export function cookiesArgs(): string[] {
  const fileVar = process.env.COOKIES_FILE;
  if (fileVar && fs.existsSync(fileVar)) return ['--cookies', fileVar];
  const b64 = process.env.YTDLP_COOKIES_B64;
  const raw = process.env.YTDLP_COOKIES;
  const content = b64 ? Buffer.from(b64, 'base64').toString('utf-8') : raw;
  if (!content) return [];
  if (!cachedCookiesPath) {
    cachedCookiesPath = path.join(os.tmpdir(), `flowfetch-cookies-${process.pid}.txt`);
    fs.writeFileSync(cachedCookiesPath, content, { mode: 0o600 });
  }
  return ['--cookies', cachedCookiesPath];
}
export function baseArgs(url: string, attempt: YtAttempt): string[] {
  // Deno is now installed in the Docker image and is yt-dlp's default
  // JavaScript runtime, so prefer it for solving YouTube's JavaScript
  // challenges; Node is the fallback.
  const args: string[] = ['--no-playlist', '--no-warnings', '--socket-timeout', '20', '--js-runtimes', 'deno,node'];
  if (attempt.extractorArgs) args.push('--extractor-args', attempt.extractorArgs);
  if (isYouTubeUrl(url)) args.push(...cookiesArgs());
  return args;
}
export function analyzeArgs(url: string, attempt: YtAttempt): string[] {
  return [...baseArgs(url, attempt), '--dump-json', '--skip-download', '--no-download', '--format', 'best', url];
}
export function downloadArgs(url: string, attempt: YtAttempt, outputPath: string): string[] {
  return [...baseArgs(url, attempt), '--output', outputPath];
}
