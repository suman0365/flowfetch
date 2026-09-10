import { UrlInput } from './UrlInput';

interface HeroProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
}

export function Hero({ onAnalyze, isLoading }: HeroProps) {
  return (
    <section className="hero-section">
      <h1 className="hero-title">Download your media, your way.</h1>
      <p className="hero-subtitle">
        Paste a public video URL, choose the quality you want, and download it in seconds.
      </p>
      <UrlInput onAnalyze={onAnalyze} isLoading={isLoading} />
    </section>
  );
}
