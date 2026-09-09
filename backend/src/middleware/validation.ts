import type { RequestHandler } from "express";
import { FlowFetchError } from "../types/index.js";

export function validateAnalyzeBody(): RequestHandler {
  return (req, _res, next) => {
    const { url } = req.body ?? {};
    if (typeof url !== "string" || url.trim().length === 0) {
      next(new FlowFetchError("INVALID_URL", "Please paste a video URL.", 400));
      return;
    }
    next();
  };
}

export function validateDownloadBody(): RequestHandler {
  return (req, _res, next) => {
    const { url, formatId } = req.body ?? {};
    if (typeof url !== "string" || url.trim().length === 0) {
      next(new FlowFetchError("INVALID_URL", "Please provide a video URL.", 400));
      return;
    }
    if (typeof formatId !== "string" || formatId.trim().length === 0 || formatId.length > 64) {
      next(new FlowFetchError("INVALID_FORMAT", "Please choose a valid format.", 400));
      return;
    }
    // yt-dlp format ids are alphanumeric with +, -, _ and . — anything else
    // is rejected outright rather than passed to the process.
    if (!/^[a-zA-Z0-9+_.\-]+$/.test(formatId)) {
      next(new FlowFetchError("INVALID_FORMAT", "That format selection isn't valid.", 400));
      return;
    }
    next();
  };
}

export function validateJobIdParam(): RequestHandler {
  return (req, _res, next) => {
    const { jobId } = req.params;
    if (!/^[a-zA-Z0-9_-]{6,32}$/.test(jobId)) {
      next(new FlowFetchError("INVALID_JOB", "That job id isn't valid.", 400));
      return;
    }
    next();
  };
}
