import { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { VideoInfo } from './components/VideoInfo';
import { FormatSelector } from './components/FormatSelector';
import { analyzeUrl, startDownload, getDownloadUrl } from './utils/api';
import type { Metadata } from './utils/api';
import './index.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingJob {
  formatId: string;
  jobId: string;
  streamMode: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Holds the pre-created job so the Download button click is SYNCHRONOUS
  // (no await before a.click()) — required to survive Chrome's gesture check.
  const pendingJobRef = useRef<PendingJob | null>(null);
  const prefetchingFormatRef = useRef<string | null>(null);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const showToast = (msg: string, durationMs = 5000) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), durationMs);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 8000);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.page === 'results' && state.metadata) {
        setMetadata(state.metadata);
      } else {
        // Back to home
        setMetadata(null);
        setAgeConfirmed(false);
        pendingJobRef.current = null;
        prefetchingFormatRef.current = null;
        setErrorMsg(null);
        setToastMsg(null);
        if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current);
      }
    };
    
    // Replace initial state with 'home' so that the very first entry is marked.
    if (!window.history.state) {
      window.history.replaceState({ page: 'home' }, "", window.location.pathname);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const sanitizeFilename = (name: string) =>
    name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'video';

  // ---------------------------------------------------------------------------
  // Analyze
  // ---------------------------------------------------------------------------

  const handleAnalyze = async (url: string) => {
    setErrorMsg(null);
    setToastMsg(null);
    setIsLoading(true);
    setMetadata(null);
    setAgeConfirmed(false);
    pendingJobRef.current = null;
    prefetchingFormatRef.current = null;
    try {
      const data = await analyzeUrl(url);
      setMetadata(data);
      window.history.pushState({ page: 'results', metadata: data }, "", "#results");
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setMetadata(null);
    setAgeConfirmed(false);
    pendingJobRef.current = null;
    prefetchingFormatRef.current = null;
    setErrorMsg(null);
    setToastMsg(null);
    if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current);

    if (window.location.hash === '#results') {
      window.history.pushState({ page: 'home' }, "", window.location.pathname);
    }
  };

  // ---------------------------------------------------------------------------
  // Pre-fetch: called when user SELECTS a format card.
  // This registers the job with the backend so the jobId is already known
  // by the time the user clicks the Download button, enabling a fully
  // SYNCHRONOUS anchor click (no await before a.click()).
  // ---------------------------------------------------------------------------

  const handleFormatSelect = async (formatId: string) => {
    if (!metadata?.analysisId) return;
    if (prefetchingFormatRef.current === formatId) return; // already in flight
    if (pendingJobRef.current?.formatId === formatId) return; // already cached

    prefetchingFormatRef.current = formatId;
    pendingJobRef.current = null;
    setIsPrefetching(true);

    try {
      const { jobId, streamMode } = await startDownload(metadata.analysisId, formatId);
      // Only cache if the user hasn't switched to another format while we waited
      if (prefetchingFormatRef.current === formatId) {
        pendingJobRef.current = { formatId, jobId, streamMode };
      }
    } catch (err) {
      // Prefetch failure is non-fatal; the Download button click has a fallback path
      console.warn('[FlowFetch] Pre-fetch failed:', err);
    } finally {
      if (prefetchingFormatRef.current === formatId) {
        prefetchingFormatRef.current = null;
        setIsPrefetching(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Download: called synchronously from the Download button onClick.
  // MUST NOT be async — a.click() must fire within the same JS call frame
  // as the user's click event to ensure Chrome treats it as a trusted gesture.
  // ---------------------------------------------------------------------------

  const handleDownload = (formatId: string) => {
    if (!metadata) return;
    if (isDownloading || isPrefetching) return;

    const format = metadata.formats.find(f => f.id === formatId);
    const ext = format ? format.ext : 'mp4';
    const resSuffix = format?.resolution && format.resolution !== 'Audio'
      ? ` - ${format.resolution}` : '';
    const filename = `${sanitizeFilename(metadata.title)}${resSuffix}.${ext}`;

    const pending = pendingJobRef.current;

    if (pending && pending.formatId === formatId) {
      // ── HAPPY PATH (synchronous) ────────────────────────────────────────
      // Job is already registered. Fire the anchor click NOW, in this same
      // call frame, before any async work. This guarantees Chrome counts it
      // as a user-initiated download and does NOT suppress it.

      const downloadUrl = getDownloadUrl(pending.jobId);

      // Step 5 console.log (mandatory confirmation line)
      console.log('NATIVE_DOWNLOAD_TRIGGER_FIRED:', downloadUrl, filename);

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;       // respected for same-origin; ignored cross-origin
      document.body.appendChild(a);
      a.click();
      a.remove();

      setIsDownloading(true);
      showToast('Download started — check your browser\'s downloads bar!');

      // Invalidate this job slot so a fresh job is created next time
      pendingJobRef.current = null;

      // For streaming modes (process_and_stream / direct):
      //   The browser opened the connection and will receive headers within ~2s.
      //   After that, the download is 100% in Chrome's hands. We reset the
      //   button quickly so the user can start another download if needed.
      //   Hard cap: if button is somehow still stuck after 30s, force-reset it.
      const releaseDelay = pending.streamMode === 'process_first' ? 60_000 : 3_000;
      downloadTimeoutRef.current = setTimeout(() => {
        setIsDownloading(false);
      }, releaseDelay);

    } else {
      // ── FALLBACK PATH ───────────────────────────────────────────────────
      // Pre-fetch didn't complete before the user clicked Download.
      // We must register the job NOW (async), then show a toast telling the
      // user the job is ready so they can click once more (which will then
      // use the synchronous happy path above).
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="app">
      <Header onLogoClick={handleReset} />
      <main className="main-content container mt-12 mb-16">

        {!metadata && (
          <Hero onAnalyze={handleAnalyze} isLoading={isLoading} />
        )}

        {metadata && (
          <div className="analysis-results">
            {toastMsg && (
              <div className="bg-success/15 text-success border border-success/30 px-4 py-3 rounded-lg mb-6 text-center font-medium">
                {toastMsg}
              </div>
            )}
            {errorMsg && (
              <div className="bg-red-500/15 text-red-400 border border-red-500/30 px-4 py-3 rounded-lg mb-6 text-center font-medium">
                {errorMsg}
              </div>
            )}
            
            {metadata.age_limit && metadata.age_limit >= 18 && !ageConfirmed ? (
              <div className="card p-8 text-center max-w-lg mx-auto mt-8 bg-surface border border-white/10 rounded-xl">
                <h2 className="text-2xl font-bold mb-4">Age Confirmation Required</h2>
                <p className="text-muted mb-8">
                  This content is age-restricted. Please confirm that you are at least 18 years old to proceed.
                </p>
                <div className="flex gap-4 justify-center">
                  <button 
                    className="btn btn-outline"
                    onClick={handleReset}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-primary"
                    onClick={() => setAgeConfirmed(true)}
                  >
                    I am 18 or older
                  </button>
                </div>
              </div>
            ) : (
              <>
                <VideoInfo metadata={metadata} onReset={handleReset} />
                <FormatSelector
                  formats={metadata.formats}
                  onDownload={handleDownload}
                  onFormatSelect={handleFormatSelect}
                  isDownloading={isDownloading}
                  isPrefetching={isPrefetching}
                />
              </>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
