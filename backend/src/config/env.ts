import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  tempDir: process.env.TEMP_DIR ? path.resolve(__dirname, '..', process.env.TEMP_DIR) : path.resolve(__dirname, '../../temp'),
  // No maxFileSize: Suman's rule (2026-11-21) is no size limit at all — any size downloads at 0 cost, slow is fine. The old 2 GB value was dead config (grep verified nothing ever read it), so it is removed rather than raised. The only real limits are the server's disk space and the time a build takes.
  downloadTimeout: parseInt(process.env.DOWNLOAD_TIMEOUT || '3600000', 10), // 1 hour
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 mins
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};
