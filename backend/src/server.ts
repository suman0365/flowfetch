import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimit';
import analyzeRouter from './routes/analyze';
import downloadRouter from './routes/download';
import progressRouter from './routes/progress';
import { startCleanupJob } from './services/cleanup';

const app = express();

// Ensure temp directories exist on startup
const tempFilesDir = path.join(config.tempDir, 'files');
fs.mkdirSync(tempFilesDir, { recursive: true });

// Allowed origins: all localhost ports + the configured production frontend URL
const allowedOrigins = new Set([config.frontendUrl]);

app.use(cors({
  origin: function (origin, callback) {
    // Allow server-to-server requests (no Origin header) and all localhost ports
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      return callback(null, true);
    }
    // Allow the configured production frontend
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    // Deny everything else
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

app.use('/api/', rateLimiter);

app.use('/api/analyze', analyzeRouter);
app.use('/api/download', downloadRouter);
app.use('/api/progress', progressRouter);

app.use(errorHandler);

// Start background tasks
startCleanupJob();

const server = app.listen(config.port, () => {
  console.log(`FlowFetch backend running on port ${config.port}`);
});

// Prevent Node.js from timing out connections during large streaming downloads.
// By default Node.js has a 5-second idle socket timeout which kills any connection
// where no bytes flow for 5 s — exactly what happens while yt-dlp downloads
// source streams before FFmpeg starts producing output.
server.setTimeout(0);        // no idle timeout on any socket
server.headersTimeout = 0;  // no timeout waiting for headers
server.keepAliveTimeout = 65000; // standard keep-alive

