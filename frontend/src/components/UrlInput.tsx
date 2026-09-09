import { useState, type FormEvent } from "react";
import { isLikelyValidUrl } from "../utils/format";

interface Props {
  onAnalyze: (url: string) => void;
  analyzing: boolean;
  error: string | null;
}

export default function UrlInput({ onAnalyze, analyzing, error }: Props) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const showValidationError = touched && trimmed.length > 0 && !isLikelyValidUrl(trimmed);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!trimmed || !isLikelyValidUrl(trimmed) || analyzing) return;
    onAnalyze(trimmed);
  }

  return (
    <form className="url-input-form" onSubmit={handleSubmit} noValidate>
      <div className="url-input-row">
        <label htmlFor="video-url" className="visually-hidden">
          Video URL
        </label>
        <input
          id="video-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a video URL here…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showValidationError || Boolean(error)}
          aria-describedby={showValidationError || error ? "url-input-error" : undefined}
          disabled={analyzing}
        />
        <button type="submit" className="btn btn-primary url-submit" disabled={analyzing || !trimmed}>
          {analyzing ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {(showValidationError || error) && (
        <p id="url-input-error" className="url-input-error" role="alert">
          {error ?? "That doesn't look like a valid link. Double-check the URL and try again."}
        </p>
      )}

      <p className="url-input-note">Works with many popular video platforms and public media URLs.</p>
    </form>
  );
}
