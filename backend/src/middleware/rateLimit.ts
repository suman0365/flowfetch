import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";

const friendlyMessage = {
  success: false,
  error: {
    code: "RATE_LIMITED",
    message: "You're doing that a bit too often. Please wait a moment and try again.",
  },
};

export const analyzeLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: friendlyMessage,
});

// Downloads are heavier on CPU/bandwidth than analysis, so they get a
// stricter budget within the same window.
export const downloadLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: Math.max(3, Math.floor(config.rateLimitMax / 3)),
  standardHeaders: true,
  legacyHeaders: false,
  message: friendlyMessage,
});
