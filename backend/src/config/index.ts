import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..", "..");

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  tempDir: process.env.TEMP_DIR
    ? path.resolve(process.env.TEMP_DIR)
    : path.join(backendRoot, "temp"),

  // Hard ceiling on any file FlowFetch will produce or serve (bytes).
  maxFileSize: num(process.env.MAX_FILE_SIZE, 2 * 1024 * 1024 * 1024), // 2 GB

  // How long a single yt-dlp / ffmpeg invocation may run before it is killed.
  downloadTimeoutMs: num(process.env.DOWNLOAD_TIMEOUT, 10 * 60 * 1000), // 10 min

  analyzeTimeoutMs: num(process.env.ANALYZE_TIMEOUT, 30 * 1000),

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW, 60 * 1000),
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 20),

  // How long a completed file is kept on disk before cleanup deletes it.
  fileRetentionMs: num(process.env.FILE_RETENTION_MS, 15 * 60 * 1000),

  // How often the cleanup sweep runs.
  cleanupIntervalMs: num(process.env.CLEANUP_INTERVAL_MS, 60 * 1000),
};

export const paths = {
  jobsDir: path.join(config.tempDir, "jobs"),
  filesDir: path.join(config.tempDir, "files"),
};
