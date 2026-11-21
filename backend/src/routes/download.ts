import { Router, Request, Response } from 'express';
import { downloader } from '../services/downloader';
import { formatCache } from '../services/formatCache';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/download  –  Create a download job and return its ID + stream mode
//
// The job is created when the user SELECTS a format (prefetch) so the
// Download click can fire the browser download synchronously, in the same
// JS call frame as the tap — required to survive Chrome's gesture check.
// This POST does NO downloading itself: the media pipeline starts when
// the browser hits GET /api/download/:jobId, so nothing is wasted if the
// user never taps Download.
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { analysisId, formatId } = req.body;

  if (!analysisId || !formatId) {
    return res.status(400).json({ success: false, error: 'analysisId and formatId are required' });
  }

  const analysis = formatCache.get(analysisId);
  if (!analysis) {
    return res
      .status(400)
      .json({ success: false, error: 'Analysis data expired or not found. Please analyze the URL again.' });
  }

  const format = analysis.formats.find((f) => f.id === formatId);
  if (!format) {
    return res.status(400).json({ success: false, error: 'Invalid format selected.' });
  }

  const { id: jobId, streamMode } = downloader.createJob(analysis.url, format, analysis.title);

  return res.json({ success: true, jobId, streamMode });
});

// ---------------------------------------------------------------------------
// GET /api/download/:jobId  –  Deliver the file to the browser
//
// IMPORTANT: This endpoint is what the browser's native download manager
// talks to directly. Headers (Content-Disposition: attachment) are sent
// immediately, so the download entry appears in Chrome Downloads the
// moment the user taps Download — there is no site-side "Preparing..."
// phase any more (v13). Once the response begins, the download is owned
// by the browser and continues independently of the React page.
//
// Modes:
//   'direct'       – Audio-only, video-only, or a progressive combined
//                    format (YouTube 18/22). yt-dlp stdout → response.
//                    Exact Content-Length, so Chrome shows true 0–100%.
//   'stream_merge' – DASH video+audio. Two yt-dlp processes stream the
//                    raw streams into FFmpeg, which muxes a fragmented
//                    MP4 (or Matroska) to stdout → response. No
//                    Content-Length (merged size is unknown until the
//                    merge finishes); Chrome shows bytes counting up.
// ---------------------------------------------------------------------------
router.get('/:jobId', async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = downloader.getJob(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Download not found or expired.' });
  }

  if (job.streamMode === 'direct') {
    await downloader.startStream(jobId, res);
    return;
  }

  await downloader.startMergeStream(jobId, res);
});

export default router;
