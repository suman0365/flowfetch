import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "What websites does FlowFetch support?",
    a: "FlowFetch supports most publicly accessible video and media pages that its extraction engine recognizes. Coverage depends on that engine's current site support, so results can vary by platform and change over time.",
  },
  {
    q: "Why can't some videos be downloaded?",
    a: "Some content is private, requires login, is region-restricted, or is protected by DRM or other technical access controls. FlowFetch does not attempt to bypass any of these — it shows a clear error instead.",
  },
  {
    q: "Why is a format missing?",
    a: "FlowFetch only shows formats its extraction engine actually reports for that specific video. If a resolution or audio-only option isn't listed, the source doesn't offer it.",
  },
  {
    q: "Where are temporary files stored?",
    a: "Downloaded files are written to a temporary directory on the server for the length of your session, then deleted automatically once the download completes or expires.",
  },
  {
    q: "Why does some video processing take longer?",
    a: "Longer videos, higher resolutions, and formats that require merging separate video and audio streams take more time to prepare than a short clip with a single combined stream.",
  },
  {
    q: "Does FlowFetch bypass DRM?",
    a: "No. FlowFetch does not bypass DRM, paywalls, authentication, or any other technical access control. It only works with content that is genuinely publicly accessible.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="faq-section" id="faq">
      <div className="container">
        <p className="eyebrow">FAQ</p>
        <h2 className="section-heading">Questions people actually ask.</h2>

        <div className="faq-list">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div className="faq-item" key={item.q}>
                <button
                  type="button"
                  className="faq-question"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <span className="faq-icon" aria-hidden="true">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <p className="faq-answer" id={`faq-panel-${i}`}>
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
