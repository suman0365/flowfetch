import { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { VideoInfo } from './components/VideoInfo';
import { FormatSelector } from './components/FormatSelector';
import { analyzeUrl, startDownload, getDownloadUrl } from './utils/api';
import { isAdultUrl } from './utils/adultSites';
import type { Metadata } from './utils/api';
import './index.css';

interface PendingJob { formatId: string; jobId: string; streamMode: string; }

export default function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Adult-link 18+ gate (before Analyze): URL that is waiting for confirmation.
  const [pendingAdultUrl, setPendingAdultUrl] = useState<string | null>(null);
  // URL the user already confirmed as 18+ in this session.
  const [adultConfirmedUrl, setAdultConfirmedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Real Analyze loading: a bar that creeps toward 85% while the server works and only reaches 100% when the real result arrives.
  const [analyzeProgress, setAnalyzeProgress] = useState<number | null>(null);
  const [analyzeStage, setAnalyzeStage] = useState('');
  const pendingJobRef = useRef<PendingJob | null>(null);
  const prefetchingFormatRef = useRef<string | null>(null);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAnalyzeProgress = () => {
    if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
    analyzeTimerRef.current = null;
    setAnalyzeProgress(null);
    setAnalyzeStage('');
  };

  const showToast = (msg: string, durationMs = 5000) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), durationMs); };

  // No auto-clear: the 8-second timeout made failures look silent again. Cleared by the next Analyze / Reset, which already set errorMsg to null.
  const showError = (msg: string) => { setErrorMsg(msg); };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.page === 'results' && state.metadata) { setMetadata(state.metadata); }
      else { setMetadata(null); setAgeConfirmed(false); setPendingAdultUrl(null); pendingJobRef.current = null; setIsDownloading(false);  prefetchingFormatRef.current = null; setErrorMsg(null); setToastMsg(null); if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current); }
    };
    if (!window.history.state) { window.history.replaceState({ page: 'home' }, "", window.location.pathname); }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const sanitizeFilename = (name: string) => name.replace(/[<>:\"/\\|?*\x00-\x1F]/g, '').trim() || 'video';

  const handleAnalyze = async (url: string) => {
    if (isAdultUrl(url) && adultConfirmedUrl !== url) {
      setPendingAdultUrl(url);
      return;
    }
    await doAnalyze(url);
  };

  const confirmAdult = async () => {
    if (!pendingAdultUrl) return;
    const url = pendingAdultUrl;
    setAdultConfirmedUrl(url);
    setPendingAdultUrl(null);
    await doAnalyze(url);
  };

  const cancelAdult = () => {
    setPendingAdultUrl(null);
  };

  const doAnalyze = async (url: string) => {
    setErrorMsg(null);
    setToastMsg(null);
    setIsLoading(true);
    setMetadata(null);
    setAgeConfirmed(false);
    pendingJobRef.current = null;
    setIsDownloading(false);
    prefetchingFormatRef.current = null;
    try {
      const startedAt = Date.now();
      setAnalyzeProgress(6);
      setAnalyzeStage('Sending your link...');
      analyzeTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setAnalyzeProgress((cur) => Math.min(85, Math.round((cur ?? 6) + (85 - (cur ?? 6)) * 0.06 + 0.4)));
        setAnalyzeStage(elapsed > 20 ? 'Taking longer than usual — the video host is slow to answer...' : elapsed > 8 ? 'Still reading — the server is working through the video...' : 'Reading video details...');
      }, 500);
      const data = await analyzeUrl(url);
      if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
      setAnalyzeProgress(100);
      setAnalyzeStage(`Found ${data.formats.length} options`);
      setMetadata(data);
      window.history.pushState({ page: 'results', metadata: data }, "", "#results"); /* On mobile the results can sit below the fold after the Hero unmounts, so scroll them into view. */ requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err) {
      stopAnalyzeProgress();
      const raw = err instanceof Error ? err.message : 'Analysis failed';
      const friendly = /not a bot|Sign in to confirm|Failed to extract any player response|EXTRACTION_BLOCKED/i.test(raw)
        ? 'YouTube blocked this video from our server (bot check). Try a non-YouTube public link, or try this link again later.'
        : raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
      showError(friendly);
    } finally {
      setIsLoading(false);
      setTimeout(() => stopAnalyzeProgress(), 600);
    }
  };

  const handleReset = () => {
    stopAnalyzeProgress(); setMetadata(null); setAgeConfirmed(false); setPendingAdultUrl(null); setAdultConfirmedUrl(null); pendingJobRef.current = null; setIsDownloading(false); prefetchingFormatRef.current = null; setErrorMsg(null); setToastMsg(null);
    if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current);
    if (window.location.hash === '#results') { window.history.pushState({ page: 'home' }, "", window.location.pathname); }
  };

  const handleFormatSelect = async (formatId: string) => {
    if (!metadata?.analysisId) return;
    if (prefetchingFormatRef.current === formatId && !pendingJobRef.current) return;
    if (pendingJobRef.current?.formatId === formatId) return;
    // Switching format frees the button (the stuck-button bug reported 2026-11-20).
    setIsDownloading(false);
    prefetchingFormatRef.current = formatId; pendingJobRef.current = null; setIsPrefetching(true);
    try {
      const { jobId, streamMode } = await startDownload(metadata.analysisId, formatId);
      if (prefetchingFormatRef.current === formatId) { pendingJobRef.current = { formatId, jobId, streamMode }; }
    } catch (err) { console.warn('[FlowFetch] Pre-fetch failed:', err); }
    finally { if (prefetchingFormatRef.current === formatId) { prefetchingFormatRef.current = null; setIsPrefetching(false); } }
  };

  const fireDownloadClick = (jobId: string, filename: string) => {
    const downloadUrl = getDownloadUrl(jobId);
    console.log('NATIVE_DOWNLOAD_TRIGGER_FIRED:', downloadUrl, filename);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;       // respected for same-origin; ignored cross-origin
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ---------------------------------------------------------------------------
  // Download: called synchronously from the Download button onClick.
  // MUST NOT be async — a.click() must fire within the same JS call frame
  // as the user's click event to ensure Chrome treats it as a trusted gesture.
  //
  // v13 (2026-11-21): the download goes STRAIGHT to the browser. There is
  // no site-side "Preparing... 0-100%" phase any more — the backend
  // streams the file (direct for single streams, live FFmpeg merge for
  // video+audio) and the browser's own Downloads shows the progress.
  // So this handler has one job: fire the anchor click synchronously.
  // ---------------------------------------------------------------------------

  const handleDownload = (formatId: string) => {
    if (!metadata) return;
    // Only block while a download is actually starting. A click during
    // prefetch is allowed: the fallback path registers the job itself, so
    // a slow first tap never leaves the button stuck.
    if (isDownloading) return;

    const format = metadata.formats.find(f => f.id === formatId);
    const ext = format ? format.ext : 'mp4';
    const resSuffix = format?.resolution && format.resolution !== 'Audio'
      ? ` - ${format.resolution}` : '';
    const filename = `${sanitizeFilename(metadata.title)}${resSuffix}.${ext}`;

    const pending = pendingJobRef.current;

    if (pending && pending.formatId === formatId) {
      // Job is already registered (prefetch on format select). Fire the
      // anchor click NOW, in this same call frame, before any async work.
      // This guarantees Chrome counts it as a user-initiated download and
      // does NOT suppress it. The backend sends the attachment headers
      // immediately, so the download entry appears in Chrome Downloads
      // at once; the file itself streams in behind it.
      fireDownloadClick(pending.jobId, filename);

      setIsDownloading(true);
      showToast('Download started — check your browser\'s downloads bar!');

      // Invalidate this job slot so a fresh job is created next time
      pendingJobRef.current = null;

      // The browser opened the connection and will receive headers within
      // seconds. After that, the download is 100% in Chrome's hands. We
      // reset the button quickly so the user can start another download.
      downloadTimeoutRef.current = setTimeout(() => {
        setIsDownloading(false);
      }, 3000);

    } else {
      // ── FALLBACK PATH ───────────────────────────────────────────────────
      // Pre-fetch didn't complete before the user clicked Download.
      // We must register the job NOW (async), then show a toast telling the
      // user the job is ready so they can click once more (which will then
      // use the synchronous path above).
      // NOTE: We cannot fire a.click() here because we're about to await —
      // doing so would break Chrome's gesture check.

      if (!metadata.analysisId) return;

      setIsDownloading(true);

      const FALLBACK_TIMEOUT_MS = 20_000;
      const timeoutHandle = setTimeout(() => {
        setIsDownloading(false);
        showError('Timed out preparing download. Please try clicking Download again.');
      }, FALLBACK_TIMEOUT_MS);

      startDownload(metadata.analysisId, formatId)
        .then(({ jobId, streamMode }) => {
          clearTimeout(timeoutHandle);
          pendingJobRef.current = { formatId, jobId, streamMode };
          setIsDownloading(false);
          showToast('Ready! Click Download once more to start.');
        })
        .catch(err => {
          clearTimeout(timeoutHandle);
          setIsDownloading(false);
          showError(err instanceof Error ? err.message : 'Failed to prepare download. Please try again.');
        });
    }
  };

  // Render
  return (
    <div className="app">
      <Header onLogoClick={handleReset} />
      <main className="main-content container mb-16">
        {toastMsg && (<div className="toast-ok">{toastMsg}</div>)}
        {errorMsg && (<div className="toast-err">{errorMsg}</div>)}
        {!metadata && (<Hero onAnalyze={handleAnalyze} isLoading={isLoading} analyzeProgress={analyzeProgress} analyzeStage={analyzeStage} />)}
        {pendingAdultUrl && !metadata && (
          <div className="card p-8 text-center max-w-lg mx-auto mt-8 bg-surface border border-white/10 rounded-xl">
            <h2 className="text-2xl font-bold mb-4">Are you 18+?</h2>
            <p className="text-muted mb-2">This link is from an adult site. This content is for adults only.</p>
            <p className="text-muted mb-8">Please confirm that you are at least 18 years old to continue.</p>
            <div className="flex gap-4 justify-center">
              <button className="btn btn-outline" onClick={cancelAdult}>No, I am under 18</button>
              <button className="btn btn-primary" onClick={confirmAdult}>Yes, I am 18 or older</button>
            </div>
          </div>
        )}
        {metadata && (
          <div className="analysis-results">
            {metadata.age_limit && metadata.age_limit >= 18 && !ageConfirmed ? (
              <div className="card p-8 text-center max-w-lg mx-auto mt-8 bg-surface border border-white/10 rounded-xl">
                <h2 className="text-2xl font-bold mb-4">Age Confirmation Required</h2>
                <p className="text-muted mb-8">This content is age-restricted. Please confirm that you are at least 18 years old to proceed.</p>
                <div className="flex gap-4 justify-center">
                  <button className="btn btn-outline" onClick={handleReset}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => setAgeConfirmed(true)}>I am 18 or older</button>
                </div>
              </div>
            ) : (
              <>
                <VideoInfo metadata={metadata} onReset={handleReset} />
                <FormatSelector formats={metadata.formats} onDownload={handleDownload} onFormatSelect={handleFormatSelect} isDownloading={isDownloading} isPrefetching={isPrefetching} />
              </>
            )}
          </div>
        )}
      </main>
      <footer className="site-footer container">FlowFetch — built for open-source videos. Paste a public link, pick a quality, download the file.</footer>
    </div>
  );
}
