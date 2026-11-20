import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
export const config = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  tempDir: process.env.TEMP_DIR ? path.resolve(__dirname, '..', process.env.TEMP_DIR) : path.resolve(__dirname, '../../temp'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '2147483648', 10),
  downloadTimeout: parseInt(process.env.DOWNLOAD_TIMEOUT || '3600000', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};
