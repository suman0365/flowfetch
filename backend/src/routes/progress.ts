import { Router, Request, Response } from 'express';
import { downloader } from '../services/downloader';
const router = Router();
router.get('/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = downloader.getJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(job.progress)}\n\n`);
  const progressListener = (progress: any) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    if (progress.status === 'complete' || progress.status === 'failed') {
      setTimeout(() => { res.end(); }, 500);
    }
  };
  downloader.on(`progress:${jobId}`, progressListener);
  req.on('close', () => { downloader.removeListener(`progress:${jobId}`, progressListener); });
});
export default router;
