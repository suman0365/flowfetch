import { spawn } from "node:child_process";
import { config } from "../config/index.js";
import { FlowFetchError, type FormatOption, type MediaInfo } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Runs yt-dlp as a child process using an argv array (never a shell string),
 * so nothing the user supplies can be interpreted as a shell command.
 * The caller controls the full argument list — user input only ever fills
 * the single positional URL slot or an already-validated format id.
 */
function runYtDlp(
  args: string[],
  { timeoutMs, onStdoutLine }: { timeoutMs: number; onStdoutLine?: (line: string) => void }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new FlowFetchError("TIMEOUT", "The request took too long.", 504));
    }, timeoutMs);

    let stdoutBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (onStdoutLine) {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const l of lines) onStdoutLine(l);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new FlowFetchError(
            "EXTRACTOR_UNAVAILABLE",
            "The media extractor (yt-dlp) is not installed on this server.",
            503
          )
        );
        return;
      }
      reject(new FlowFetchError("EXTRACTOR_ERROR", "Could not start the media extractor.", 502));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

function classifyYtDlpFailure(stderr: string): FlowFetchError {
  const s = stderr.toLowerCase();
  if (s.includes("unsupported url")) {
    return new FlowFetchError("UNSUPPORTED_SITE", "FlowFetch doesn't support this website yet.", 422);
  }
  if (s.includes("private video") || s.includes("login required") || s.includes("sign in")) {
    return new FlowFetchError("PRIVATE_CONTENT", "This content is private or requires an account.", 403);
  }
  if (s.includes("drm") || s.includes("protected")) {
    return new FlowFetchError("PROTECTED_CONTENT", "This content is protected and can't be downloaded.", 403);
  }
  if (s.includes("geo") && s.includes("restrict")) {
    return new FlowFetchError("GEO_RESTRICTED", "This content isn't available in the server's region.", 403);
  }
  if (s.includes("video unavailable") || s.includes("this video is unavailable")) {
    return new FlowFetchError("UNAVAILABLE", "This video is unavailable.", 404);
  }
  if (s.includes("timed out") || s.includes("timeout")) {
    return new FlowFetchError("TIMEOUT", "The source took too long to respond.", 504);
  }
  return new FlowFetchError("EXTRACTOR_ERROR", "We couldn't process that URL.", 422);
}

function pickContainer(f: any): string {
  return (f.ext as string) || "mp4";
}

function kindOf(f: any): FormatOption["kind"] {
  const hasVideo = f.vcodec && f.vcodec !== "none";
  const hasAudio = f.acodec && f.acodec !== "none";
  if (hasVideo && hasAudio) return "video+audio";
  if (hasVideo) return "video-only";
  return "audio-only";
}

function labelFor(f: any, kind: FormatOption["kind"]): string {
  const ext = pickContainer(f).toUpperCase();
  if (kind === "audio-only") {
    const abr = f.abr ? `${Math.round(f.abr)}kbps` : "";
    return [ext, abr].filter(Boolean).join(" ");
  }
  const res = f.height ? `${f.height}p` : f.format_note || "";
  return [res, ext].filter(Boolean).join(" ");
}

function normalizeFormats(raw: any[]): FormatOption[] {
  const usable = raw.filter((f) => {
    // Skip formats yt-dlp itself flags as unplayable/storyboards.
    if (f.format_note === "storyboard" || f.vcodec === "none" && f.acodec === "none") return false;
    return true;
  });

  const formats: FormatOption[] = usable.map((f) => {
    const kind = kindOf(f);
    return {
      formatId: String(f.format_id),
      container: pickContainer(f),
      kind,
      resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
      height: f.height ?? null,
      fps: f.fps ?? null,
      vcodec: f.vcodec && f.vcodec !== "none" ? f.vcodec : null,
      acodec: f.acodec && f.acodec !== "none" ? f.acodec : null,
      abr: f.abr ?? null,
      vbr: f.vbr ?? null,
      filesizeBytes: f.filesize ?? f.filesize_approx ?? null,
      filesizeApprox: !f.filesize && !!f.filesize_approx,
      label: labelFor(f, kind),
      recommended: false,
    };
  });

  // Recommend the highest-resolution combined video+audio format, since
  // that's the single-click "just give me the video" option.
  const combined = formats
    .filter((f) => f.kind === "video+audio")
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (combined[0]) combined[0].recommended = true;

  // Sort: combined formats first (best to worst), then video-only, then audio-only.
  const order: Record<FormatOption["kind"], number> = {
    "video+audio": 0,
    "video-only": 1,
    "audio-only": 2,
  };
  formats.sort((a, b) => {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    return (b.height ?? b.abr ?? 0) - (a.height ?? a.abr ?? 0);
  });

  return formats;
}

export async function fetchMediaInfo(url: string): Promise<MediaInfo> {
  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--socket-timeout",
    "15",
    "--",
    url,
  ];

  const { stdout, stderr, code } = await runYtDlp(args, { timeoutMs: config.analyzeTimeoutMs });

  if (code !== 0) {
    logger.warn("yt-dlp analyze failed", { code });
    throw classifyYtDlpFailure(stderr);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new FlowFetchError("EXTRACTOR_ERROR", "We couldn't read the media information.", 502);
  }

  const formats = normalizeFormats(Array.isArray(parsed.formats) ? parsed.formats : []);
  if (formats.length === 0) {
    throw new FlowFetchError("NO_FORMATS", "No downloadable formats were found for this URL.", 422);
  }

  return {
    sourceUrl: url,
    title: parsed.title ?? "Untitled",
    thumbnail: parsed.thumbnail ?? null,
    durationSeconds: typeof parsed.duration === "number" ? parsed.duration : null,
    uploader: parsed.uploader ?? parsed.channel ?? null,
    site: parsed.extractor_key ?? parsed.extractor ?? "Unknown",
    description: typeof parsed.description === "string" ? parsed.description.slice(0, 500) : null,
    formats,
  };
}

export interface DownloadProgressEvent {
  status: "downloading" | "merging";
  percent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
}

const PROGRESS_RE =
  /\[download\]\s+(?:(\d+(?:\.\d+)?)%)?.*?(?:of\s+~?([\d.]+\w+))?.*?(?:at\s+([\d.]+\w+\/s))?.*?(?:ETA\s+([\d:]+))?/i;

function parseSize(str: string | undefined): number | null {
  if (!str) return null;
  const m = str.match(/([\d.]+)\s*([KMGT]?i?B)/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
  };
  return value * (multipliers[unit] ?? 1);
}

function parseEta(str: string | undefined): number | null {
  if (!str) return null;
  const parts = str.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

/**
 * Downloads (and, if needed, merges) the requested format into outputTemplate.
 * formatId must already be one of the ids fetchMediaInfo returned for this
 * exact URL — callers are responsible for that validation.
 */
export async function downloadFormat(
  url: string,
  formatId: string,
  outputTemplate: string,
  onProgress: (event: DownloadProgressEvent) => void
): Promise<{ outputPath: string }> {
  const args = [
    "-f",
    formatId,
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--merge-output-format",
    "mp4",
    "--newline",
    "--print",
    "after_move:%(filepath)s",
    "-o",
    outputTemplate,
    "--",
    url,
  ];

  let resolvedPath: string | null = null;

  const { stderr, code } = await runYtDlp(args, {
    timeoutMs: config.downloadTimeoutMs,
    onStdoutLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.includes("[Merger]") || trimmed.includes("Merging formats")) {
        onProgress({
          status: "merging",
          percent: null,
          downloadedBytes: null,
          totalBytes: null,
          speedBytesPerSec: null,
          etaSeconds: null,
        });
        return;
      }

      if (trimmed.startsWith("[download]")) {
        const match = trimmed.match(PROGRESS_RE);
        if (match) {
          onProgress({
            status: "downloading",
            percent: match[1] ? parseFloat(match[1]) : null,
            downloadedBytes: null,
            totalBytes: parseSize(match[2]),
            speedBytesPerSec: parseSize(match[3]),
            etaSeconds: parseEta(match[4]),
          });
        }
        return;
      }

      // Our --print after_move line: the final absolute file path.
      if (!trimmed.startsWith("[") && trimmed.length > 0) {
        resolvedPath = trimmed;
      }
    },
  });

  if (code !== 0) {
    logger.warn("yt-dlp download failed", { code });
    throw classifyYtDlpFailure(stderr);
  }

  if (!resolvedPath) {
    throw new FlowFetchError("EXTRACTOR_ERROR", "The download finished but no output file was reported.", 502);
  }

  return { outputPath: resolvedPath };
}
