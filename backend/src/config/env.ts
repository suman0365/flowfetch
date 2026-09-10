import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  // Use TEMP_DIR env var as an absolute path if set, otherwise fall back to
  // <cwd>/temp. Avoids fragile __dirname-relative paths in compiled output.
  tempDir: process.env.TEMP_DIR
    ? path.resolve(process.env.TEMP_DIR)
    : path.resolve(process.cwd(), 'temp'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '2147483648', 10), // 2GB
  downloadTimeout: parseInt(process.env.DOWNLOAD_TIMEOUT || '3600000', 10), // 1 hour
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 mins
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};

