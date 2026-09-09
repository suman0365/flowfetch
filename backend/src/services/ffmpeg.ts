import { spawn } from "node:child_process";

let cachedAvailability: boolean | null = null;

/**
 * yt-dlp shells out to ffmpeg itself for merging/remuxing, so this service
 * only needs to confirm ffmpeg is on PATH — useful for the startup check
 * and for giving an honest "not installed" error instead of a confusing
 * extractor failure later.
 */
export function isFfmpegAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return Promise.resolve(cachedAvailability);

  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.on("error", () => {
      cachedAvailability = false;
      resolve(false);
    });
    child.on("close", (code) => {
      cachedAvailability = code === 0;
      resolve(cachedAvailability);
    });
  });
}
