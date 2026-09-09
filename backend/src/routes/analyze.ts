import { Router } from "express";
import { assertSafeMediaUrl } from "../utils/urlValidator.js";
import { fetchMediaInfo } from "../services/ytdlp.js";
import { validateAnalyzeBody } from "../middleware/validation.js";
import { analyzeLimiter } from "../middleware/rateLimit.js";
import { logger } from "../utils/logger.js";

export const analyzeRouter = Router();

analyzeRouter.post("/analyze", analyzeLimiter, validateAnalyzeBody(), async (req, res, next) => {
  const start = Date.now();
  try {
    const url = await assertSafeMediaUrl(req.body.url);
    const info = await fetchMediaInfo(url.toString());

    logger.info("Analyze succeeded", { site: info.site, durationMs: Date.now() - start });

    res.json({
      success: true,
      data: {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.durationSeconds,
        uploader: info.uploader,
        site: info.site,
        description: info.description,
        formats: info.formats,
        sourceUrl: info.sourceUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});
