import UrlInput from "./UrlInput";

interface Props {
  onAnalyze: (url: string) => void;
  analyzing: boolean;
  error: string | null;
}

export default function Hero({ onAnalyze, analyzing, error }: Props) {
  return (
    <section className="hero">
      <div className="container hero-inner">
        <p className="eyebrow">Paste. Choose. Download.</p>
        <h1 className="hero-heading">Download your media, your way.</h1>
        <p className="hero-subheading">
          Paste a public video URL, choose the quality you want, and download it in seconds.
        </p>

        <div className="hero-input-wrap">
          <svg className="hero-flow-line" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="20" x2="600" y2="20" stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="2 10" strokeLinecap="round" />
          </svg>
          <UrlInput onAnalyze={onAnalyze} analyzing={analyzing} error={error} />
        </div>

        {analyzing && (
          <p className="hero-status" role="status" aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" />
            Analyzing URL…
          </p>
        )}
      </div>
    </section>
  );
}
