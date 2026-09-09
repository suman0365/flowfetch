export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <span className="logo-word">FlowFetch</span>
          <p>Paste. Choose. Download.</p>
        </div>

        <nav className="footer-nav" aria-label="Footer">
          <a href="#top">Home</a>
          <a href="#how-it-works">How it works</a>
          <a href="#supported-sites">Supported sites</a>
          <a href="#faq">FAQ</a>
          <a href="#top">Privacy</a>
          <a href="#top">Terms</a>
        </nav>

        <p className="footer-disclaimer">
          Download only content you have permission to download. FlowFetch does not bypass DRM, paywalls, or
          access controls.
        </p>
      </div>
    </footer>
  );
}
