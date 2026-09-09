const FEATURES = [
  {
    title: "Fast processing",
    body: "Metadata and formats are fetched directly from the source, so you see real options in seconds.",
  },
  {
    title: "Pick your quality",
    body: "Every resolution and format shown is one the extractor actually found — nothing invented, nothing padded.",
  },
  {
    title: "Clean and simple",
    body: "Paste, choose, download. No account, no clutter, no extra steps in the way.",
  },
  {
    title: "Privacy-conscious handling",
    body: "Downloaded files live on the server only long enough to reach you, then they're deleted automatically.",
  },
];

export default function WhyFlowFetch() {
  return (
    <section className="why-section">
      <div className="container">
        <p className="eyebrow">Why FlowFetch</p>
        <h2 className="section-heading">Built to be dependable, not flashy.</h2>

        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="card feature-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
