import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimit';
import analyzeRouter from './routes/analyze';
import downloadRouter from './routes/download';
import progressRouter from './routes/progress';
import { startCleanupJob } from './services/cleanup';
const app = express();
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(null, config.frontendUrl);
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use('/api/', rateLimiter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/download', downloadRouter);
app.use('/api/progress', progressRouter);
app.use(errorHandler);
startCleanupJob();
const server = app.listen(config.port, () => {
  console.log(`FlowFetch backend running on port ${config.port}`);
});
server.setTimeout(0);
server.headersTimeout = 0;
server.keepAliveTimeout = 65000;
