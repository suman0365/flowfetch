import { useState } from "react";
import ThemeToggle from "./ThemeToggle";
import "./Header.css";

const NAV_LINKS = [
  { label: "Home", href: "#top" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Supported sites", href: "#supported-sites" },
  { label: "FAQ", href: "#faq" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header" id="top">
      <div className="container site-header-inner">
        <a href="#top" className="logo" aria-label="FlowFetch home">
          <span className="logo-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
              <path d="M10 9v14l13-7z" fill="var(--color-surface)" />
            </svg>
          </span>
          <span className="logo-word">FlowFetch</span>
        </a>

        <nav className="main-nav" aria-label="Primary">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="header-actions">
          <ThemeToggle />
          <a href="#top" className="btn btn-secondary header-cta">
            Get started
          </a>
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {menuOpen ? (
                <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={() => setMenuOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
