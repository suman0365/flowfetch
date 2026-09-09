import type { ErrorRequestHandler, RequestHandler } from "express";
import { FlowFetchError } from "../types/index.js";
import { logger } from "../utils/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found." } });
};

// Central error handler: converts every thrown error into a friendly,
// consistent JSON shape and never leaks stack traces to the client.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof FlowFetchError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { code: err.code, path: req.path });
    }
    res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
    return;
  }

  logger.error("Unhandled server error", {
    path: req.path,
    message: (err as Error)?.message ?? "unknown",
  });

  res.status(500).json({
    success: false,
    error: { code: "SERVER_ERROR", message: "Something went wrong on our end. Please try again." },
  });
};
