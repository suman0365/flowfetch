import { UrlInput } from './UrlInput';

interface HeroProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
  analyzeProgress: number | null;
  analyzeStage: string;
}

export function Hero({ onAnalyze, isLoading, analyzeProgress, analyzeStage }: HeroProps) {
  return (
    <section className="hero-section">
      <span className="hero-pill">Free · No sign-up · No watermark</span>
      <h1 className="hero-title">Download a public video in the quality you want.</h1>
      <p className="hero-subtitle">
        Paste a link. Pick a quality. The file downloads.
      </p>
      <div className="window-frame">
        <div className="window-bar">
          <span className="window-dot" />
          <span className="window-dot" />
          <span className="window-dot" />
          <span className="window-label">flowfetch — paste a link</span>
        </div>
        <UrlInput
          onAnalyze={onAnalyze}
          isLoading={isLoading}
          analyzeProgress={analyzeProgress}
          analyzeStage={analyzeStage}
        />
      </div>

      <div className="hero-steps">
        <div className="step">
          <span className="step-num">01</span>
          <div className="step-title">Paste a link</div>
          <div className="step-text">Any public video URL — YouTube, Instagram, Facebook and more.</div>
        </div>
        <div className="step">
          <span className="step-num">02</span>
          <div className="step-title">Pick a quality</div>
          <div className="step-text">Every quality the video has, from 144p to 4K, plus audio only.</div>
        </div>
        <div className="step">
          <span className="step-num">03</span>
          <div className="step-title">Download the file</div>
          <div className="step-text">The file lands in your downloads. Nothing is kept on our side.</div>
        </div>
      </div>

      <div className="site-strip">
        <span className="site-chip">YouTube</span>
        <span className="site-chip">Instagram</span>
        <span className="site-chip">Facebook</span>
        <span className="site-chip">Archive.org</span>
        <span className="site-chip">SoundCloud</span>
        <span className="site-chip">Vimeo</span>
        <span className="site-chip">Direct MP4</span>
      </div>
    </section>
  );
}
