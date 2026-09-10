import { Router, Request, Response } from 'express';
import { downloader } from '../services/downloader';

const router = Router();

// GET /api/progress/:jobId -> Stream progress using Server-Sent Events (SSE)
router.get('/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = downloader.getJob(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  // Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial state immediately
  res.write(`data: ${JSON.stringify(job.progress)}\n\n`);

  // Event listener for updates
  const progressListener = (progress: any) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    
    // If complete or failed, close connection after a short delay
    if (progress.status === 'complete' || progress.status === 'failed') {
      setTimeout(() => {
        res.end();
      }, 500);
    }
  };

  downloader.on(`progress:${jobId}`, progressListener);

  // Handle client disconnect
  req.on('close', () => {
    downloader.removeListener(`progress:${jobId}`, progressListener);
  });
});

export default router;
