import { Moon, Sun, ArrowDownToLine } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface HeaderProps {
  onLogoClick?: () => void;
}

export function Header({ onLogoClick }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="header">
      <div className="container flex items-center justify-between">
        <div 
          className="logo flex items-center gap-2"
          onClick={onLogoClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onLogoClick) onLogoClick();
          }}
        >
          <ArrowDownToLine size={24} className="text-primary" />
          <span className="logo-text">FlowFetch</span>
        </div>
        
        <nav className="nav-desktop">
          <a href="#how-it-works">How it works</a>
          <a href="#supported-sites">Supported sites</a>
          <a href="#faq">FAQ</a>
        </nav>

        <div className="header-actions">
          <button 
            className="theme-toggle" 
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
