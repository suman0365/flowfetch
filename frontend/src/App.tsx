import { useCallback, useRef, useState } from "react";
import Header from "./components/Header";
import Hero from "./components/Hero";
import VideoInfo from "./components/VideoInfo";
import FormatSelector from "./components/FormatSelector";
import DownloadProgress from "./components/DownloadProgress";
import DownloadComplete from "./components/DownloadComplete";
import WhyFlowFetch from "./components/WhyFlowFetch";
import HowItWorks from "./components/HowItWorks";
import SupportedSites from "./components/SupportedSites";
import FAQ from "./components/FAQ";
import Footer from "./components/Footer";
import { analyzeUrl, createDownload, subscribeToProgress, ApiRequestError } from "./services/api";
import type { FormatOption, JobProgressEvent, MediaInfo } from "./types";
import "./App.css";

type Stage = "idle" | "analyzing" | "analyzed" | "downloading" | "complete";

export default function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [selectedFormat, setSelectedFormat] = useState<FormatOption | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgressEvent | null>(null);
  const [starting, setStarting] = useState(false);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const handleAnalyze = useCallback(async (url: string) => {
    setStage("analyzing");
    setAnalyzeError(null);
    setMediaInfo(null);
    setSelectedFormat(null);
    try {
      const info = await analyzeUrl(url);
      setMediaInfo(info);
      setStage("analyzed");
      queueMicrotask(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setStage("idle");
      setAnalyzeError(
        err instanceof ApiRequestError ? err.message : "We couldn't process that URL. Please check the link and try again."
      );
    }
  }, []);

  const handleReset = useCallback(() => {
    unsubscribeRef.current?.();
    setStage("idle");
    setMediaInfo(null);
    setSelectedFormat(null);
    setAnalyzeError(null);
    setDownloadError(null);
    setProgress(null);
  }, []);

  const handleStartDownload = useCallback(async () => {
    if (!mediaInfo || !selectedFormat || starting) return;
    setStarting(true);
    setDownloadError(null);
    try {
      const { jobId } = await createDownload(mediaInfo.sourceUrl, selectedFormat.formatId);
      setStage("downloading");
      setProgress({
        jobId,
        status: "queued",
        percent: null,
        downloadedBytes: null,
        totalBytes: null,
        speedBytesPerSec: null,
        etaSeconds: null,
        message: "Preparing download…",
        error: null,
        result: null,
      });

      unsubscribeRef.current = subscribeToProgress(
        jobId,
        (event) => {
          setProgress(event);
          if (event.status === "complete") setStage("complete");
          if (event.status === "failed") {
            setDownloadError(event.error?.message ?? "The download failed. Please try again.");
          }
        },
        () => setDownloadError("Lost connection while tracking this download. Please try again.")
      );
    } catch (err) {
      setDownloadError(
        err instanceof ApiRequestError ? err.message : "We couldn't start the download. Please try again."
      );
    } finally {
      setStarting(false);
    }
  }, [mediaInfo, selectedFormat, starting]);

  const handleDownloadAnother = useCallback(() => {
    handleReset();
  }, [handleReset]);

  return (
    <>
      <Header />
      <main>
        <Hero onAnalyze={handleAnalyze} analyzing={stage === "analyzing"} error={analyzeError} />

        {(stage === "analyzed" || stage === "downloading" || stage === "complete") && mediaInfo && (
          <section className="results-section" ref={resultsRef} aria-live="polite">
            <div className="container results-grid">
              <VideoInfo info={mediaInfo} onChangeUrl={handleReset} />

              <div className="results-side">
                {stage === "analyzed" && (
                  <FormatSelector
                    formats={mediaInfo.formats}
                    selected={selectedFormat}
                    onSelect={setSelectedFormat}
                    onDownload={handleStartDownload}
                    starting={starting}
                    error={downloadError}
                  />
                )}

                {stage === "downloading" && progress && (
                  <DownloadProgress progress={progress} error={downloadError} onRetry={handleStartDownload} />
                )}

                {stage === "complete" && progress?.result && (
                  <DownloadComplete result={progress.result} onDownloadAnother={handleDownloadAnother} />
                )}
              </div>
            </div>
          </section>
        )}

        <WhyFlowFetch />
        <HowItWorks />
        <SupportedSites />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
