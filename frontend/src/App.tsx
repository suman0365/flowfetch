import { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { VideoInfo } from './components/VideoInfo';
import { FormatSelector } from './components/FormatSelector';
import { analyzeUrl, startDownload, getDownloadUrl, getDownloadStatus } from './utils/api';
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
    // Live server-side progress while a merged file is prepared (0-100), shown on the button so it never looks frozen.
    const [preparingPercent, setPreparingPercent] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pendingJobRef = useRef<PendingJob | null>(null);
  const readyJobRef = useRef<PendingJob | null>(null);
  const pollingJobRef = useRef<string | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const stopPolling = () => {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          pollingJobRef.current = null;
    };
  const prefetchingFormatRef = useRef<string | null>(null);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string, durationMs = 5000) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), durationMs); };
  // No auto-clear: the 8-second timeout made failures look silent again. Cleared by the next Analyze / Reset, which already set errorMsg to null.
  const showError = (msg: string) => { setErrorMsg(msg);  };
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.page === 'results' && state.metadata) { setMetadata(state.metadata); }
          else { setMetadata(null); setAgeConfirmed(false); setPendingAdultUrl(null); pendingJobRef.current = null; readyJobRef.current = null; stopPolling(); setPreparingPercent(null); setIsDownloading(false);  prefetchingFormatRef.current = null; setErrorMsg(null); setToastMsg(null); if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current); }
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
    readyJobRef.current = null;
      stopPolling();
      setPreparingPercent(null);
      setIsDownloading(false);
    prefetchingFormatRef.current = null;
    try {
      const data = await analyzeUrl(url);
      setMetadata(data);
      window.history.pushState({ page: 'results', metadata: data }, "", "#results"); /* On mobile the results can sit below the fold after the Hero unmounts, so scroll them into view. */ requestAnimationFrame(() => { document.querySelector('.analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } catch (err) {
            const raw = err instanceof Error ? err.message : 'Analysis failed';       
      const friendly = /not a bot|Sign in to confirm|Failed to extract any player response|EXTRACTION_BLOCKED/i.test(raw)         
          ? 'YouTube blocked this video from our server (bot check). Try a non-YouTube public link, or try this link again later.'         
          : raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;       
      showError(friendly);
    } finally {
      setIsLoading(false);
    }
  };
  const handleReset = () => {
      setMetadata(null); setAgeConfirmed(false); setPendingAdultUrl(null); setAdultConfirmedUrl(null); pendingJobRef.current = null; readyJobRef.current = null; stopPolling(); setPreparingPercent(null); setIsDownloading(false); prefetchingFormatRef.current = null;
    if (downloadTimeoutRef.current) clearTimeout(downloadTimeoutRef.current);
    if (window.location.hash === '#results') { window.history.pushState({ page: 'home' }, "", window.location.pathname); }
  };
  const handleFormatSelect = async (formatId: string) => {
    if (!metadata?.analysisId) return;
    if (prefetchingFormatRef.current === formatId) return;
    if (pendingJobRef.current?.formatId === formatId) return;
    // Switching format frees the button (the stuck-button bug reported 2026-11-20).
    stopPolling();
    readyJobRef.current = null;
    setPreparingPercent(null);
    setIsDownloading(false);
    prefetchingFormatRef.current = formatId; pendingJobRef.current = null; setIsPrefetching(true);
    try {
      const { jobId, streamMode } = await startDownload(metadata.analysisId, formatId);
      if (prefetchingFormatRef.current === formatId) { pendingJobRef.current = { formatId, jobId, streamMode }; }
    } catch (err) { console.warn('[FlowFetch] Pre-fetch failed:', err); }
    finally { if (prefetchingFormatRef.current === formatId) { prefetchingFormatRef.current = null; setIsPrefetching(false); } }
  };
  const pollDownloadStatus = (jobId: string) => {
      if (pollingJobRef.current === jobId) return;
      pollingJobRef.current = jobId;
      const startedAt = Date.now();
      const MAX_POLL_MS = 5 * 60 * 1000;
      pollTimerRef.current = setInterval(async () => {
            if (Date.now() - startedAt > MAX_POLL_MS) {
                    stopPolling();
                    setPreparingPercent(null);
                    setIsDownloading(false);
                    showToast('Still preparing — tap Download again to check.');
                    return;
            }
            try {
                    const res = await getDownloadStatus(jobId);
                    if (typeof res.percent === 'number') setPreparingPercent(res.percent);
                    if (res.status === 'ready') {
                              stopPolling();
                              if (pendingJobRef.current?.jobId === jobId) readyJobRef.current = pendingJobRef.current;
                              setPreparingPercent(null);
                              setIsDownloading(false);
                              showToast('Ready! Click Download once more to start.');
                    } else if (res.status === 'failed') {
                              stopPolling();
                              pendingJobRef.current = null;
                              setPreparingPercent(null);
                              setIsDownloading(false);
                              showError('Download failed on the server. Please try again.');
                    }
            } catch {
                    // Keep polling on fetch errors.
            }
      }, 2000);
  };

  const fireDownloadClick = (jobId: string, filename: string) => {
    const downloadUrl = getDownloadUrl(jobId);
    console.log('NATIVE_DOWNLOAD_TRIGGER_FIRED:', downloadUrl, filename);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const handleDownload = (formatId: string) => {
    if (!metadata) return;
    if (isDownloading || isPrefetching) return;
    const format = metadata.formats.find(f => f.id === formatId);
    const ext = format ? format.ext : 'mp4';
    const resSuffix = format?.resolution && format.resolution !== 'Audio' ? ` - ${format.resolution}` : '';
    const filename = `${sanitizeFilename(metadata.title)}${resSuffix}.${ext}`;
    const ready = readyJobRef.current;
    if (ready && ready.formatId === formatId) {
      fireDownloadClick(ready.jobId, filename);
      readyJobRef.current = null;
      pendingJobRef.current = null;
      setPreparingPercent(null);
      setIsDownloading(true);
      showToast("Download started - check your browser's downloads bar!");
      downloadTimeoutRef.current = setTimeout(() => { setIsDownloading(false); }, 3_000);
      return;
    }
    const pending = pendingJobRef.current;
    if (pending && pending.formatId === formatId && pending.streamMode === 'process_first') {
      setIsDownloading(true);
      showToast('Preparing your video on the server... this takes a minute for large videos.');
      pollDownloadStatus(pending.jobId);
      return;
    }
    if (pending && pending.formatId === formatId) {
      fireDownloadClick(pending.jobId, filename);
      setIsDownloading(true); showToast("Download started - check your browser's downloads bar!");
      pendingJobRef.current = null;
      const releaseDelay = pending.streamMode === 'process_first' ? 60_000 : 3_000;
      downloadTimeoutRef.current = setTimeout(() => { setIsDownloading(false); }, releaseDelay);
    } else {
      if (!metadata.analysisId) return;
      setIsDownloading(true);
      const FALLBACK_TIMEOUT_MS = 20_000;
      const timeoutHandle = setTimeout(() => { setIsDownloading(false); showError('Timed out preparing download. Please try clicking Download again.'); }, FALLBACK_TIMEOUT_MS);
      startDownload(metadata.analysisId, formatId)
        .then(({ jobId, streamMode }) => { clearTimeout(timeoutHandle); pendingJobRef.current = { formatId, jobId, streamMode }; if (streamMode === 'process_first') { setIsDownloading(true); showToast('Preparing your video on the server... this takes a minute for large videos.'); pollDownloadStatus(jobId); } else { setIsDownloading(false); showToast('Ready! Click Download once more to start.'); } })
        .catch(err => { clearTimeout(timeoutHandle); setIsDownloading(false); showError(err instanceof Error ? err.message : 'Failed to prepare download. Please try again.'); });
    }
  };
  return (
    <div className="app">
      <Header onLogoClick={handleReset} />
      <main className="main-content container mt-12 mb-16"> 
        {toastMsg && (<div className="bg-success/15 text-success border border-success/30 px-4 py-3 rounded-lg mb-6 text-center font-medium">{toastMsg}</div>)} 
        {errorMsg && (<div className="bg-red-500/15 text-red-400 border border-red-500/30 px-4 py-3 rounded-lg mb-6 text-center font-medium">{errorMsg}</div>)}
        {!metadata && (<Hero onAnalyze={handleAnalyze} isLoading={isLoading} />)}
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
                <FormatSelector formats={metadata.formats} onDownload={handleDownload} onFormatSelect={handleFormatSelect} isDownloading={isDownloading} isPrefetching={isPrefetching} preparingPercent={preparingPercent} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
