import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

export const startCleanupJob = () => {
  // Run every 15 minutes
  setInterval(() => {
    cleanupOldFiles();
  }, 15 * 60 * 1000);
  
  // Also run on startup
  cleanupOldFiles();
};

const cleanupOldFiles = () => {
  const filesDir = path.join(config.tempDir, 'files');
  
  if (!fs.existsSync(filesDir)) return;

  fs.readdir(filesDir, (err, files) => {
    if (err) {
      console.error('Failed to read temp files directory:', err);
      return;
    }

    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(filesDir, file);
      
      fs.stat(filePath, (err, stats) => {
        if (err) return;

        // Delete files older than downloadTimeout
        if (now - stats.mtimeMs > config.downloadTimeout) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Failed to delete old file ${file}:`, err);
            } else {
              console.log(`Cleaned up old file: ${file}`);
            }
          });
        }
      });
    });
  });
};
