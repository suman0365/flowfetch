import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { config, paths } from "./config/index.js";
import { analyzeRouter } from "./routes/analyze.js";
import { downloadRouter } from "./routes/download.js";
import { progressRouter } from "./routes/progress.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { startCleanupScheduler } from "./services/cleanup.js";
import { isFfmpegAvailable } from "./services/ffmpeg.js";
import { logger } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureTempDirs() {
  await fs.mkdir(paths.jobsDir, { recursive: true });
  await fs.mkdir(paths.filesDir, { recursive: true });
}

async function main() {
  await ensureTempDirs();

  const app = express();

  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: "10kb" })); // requests only ever carry a URL + format id

  app.get("/api/health", async (_req, res) => {
    const ffmpegOk = await isFfmpegAvailable();
    res.json({ success: true, data: { status: "ok", ffmpegAvailable: ffmpegOk } });
  });

  app.use("/api", analyzeRouter);
  app.use("/api", downloadRouter);
  app.use("/api", progressRouter);

  // --- Production: serve the frontend SPA from the built static files ---
  if (config.nodeEnv === "production") {
    // In the Docker image, the frontend dist is copied to /app/frontend/dist.
    // Relative to the compiled backend at /app/backend/dist/server.js,
    // that's ../../frontend/dist.
    const frontendDist = path.resolve(__dirname, "..", "..", "frontend", "dist");

    app.use(express.static(frontendDist));

    // SPA fallback: any GET that didn't match an API route or a static file
    // gets the React app's index.html so client-side routing works.
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  startCleanupScheduler();

  const ffmpegOk = await isFfmpegAvailable();
  if (!ffmpegOk) {
    logger.warn(
      "ffmpeg was not found on PATH — merging separate video/audio formats will fail until it's installed."
    );
  }

  app.listen(config.port, () => {
    logger.info(`FlowFetch backend listening`, { port: config.port, env: config.nodeEnv });
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: (err as Error).message });
  process.exit(1);
});

