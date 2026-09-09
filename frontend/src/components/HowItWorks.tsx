const STEPS = [
  { n: "01", title: "Paste the URL", body: "Drop in a link to a publicly accessible video or media page." },
  { n: "02", title: "Choose the format", body: "Pick the resolution or audio-only option that fits what you need." },
  { n: "03", title: "Download the file", body: "FlowFetch prepares it and hands you the finished file." },
];

export default function HowItWorks() {
  return (
    <section className="how-section" id="how-it-works">
      <div className="container">
        <p className="eyebrow">How it works</p>
        <h2 className="section-heading">Three steps, in order.</h2>

        <ol className="steps-list">
          {STEPS.map((s) => (
            <li className="step-item" key={s.n}>
              <span className="step-number mono">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
