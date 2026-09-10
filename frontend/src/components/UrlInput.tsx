import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface UrlInputProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
}

export function UrlInput({ onAnalyze, isLoading }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please enter a valid URL');
      return;
    }
    
    try {
      new URL(url);
      setError('');
      onAnalyze(url);
    } catch {
      setError('Please enter a valid HTTP/HTTPS URL');
    }
  };

  return (
    <div className="url-input-container">
      <form onSubmit={handleSubmit} className="url-form">
        <div className="input-wrapper">
          <Search className="input-icon" size={20} />
          <input
            type="url"
            className="input url-input"
            placeholder="Paste a video URL here..."
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            disabled={isLoading}
            required
          />
        </div>
        <button 
          type="submit" 
          className="btn btn-primary analyze-btn"
          disabled={isLoading || !url.trim()}
        >
          {isLoading ? (
            <>
              <Loader2 className="spinner" size={20} />
              Analyzing...
            </>
          ) : (
            'Analyze'
          )}
        </button>
      </form>
      {error && <p className="error-text mt-2">{error}</p>}
      <p className="helper-text mt-2">
        Works with many popular video platforms and public media URLs.
      </p>
    </div>
  );
}
