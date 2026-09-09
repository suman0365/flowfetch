const EXAMPLE_PLATFORMS = [
  "YouTube",
  "Vimeo",
  "SoundCloud",
  "Twitch clips",
  "Dailymotion",
  "Bandcamp",
];

export default function SupportedSites() {
  return (
    <section className="supported-section" id="supported-sites">
      <div className="container">
        <p className="eyebrow">Supported platforms</p>
        <h2 className="section-heading">Supported platforms vary by source and extractor compatibility.</h2>
        <p className="supported-note">
          FlowFetch relies on a maintained, community-driven extraction engine that supports a wide range of
          public sites. Some examples of platforms it commonly works with:
        </p>

        <ul className="platform-list">
          {EXAMPLE_PLATFORMS.map((p) => (
            <li key={p} className="platform-chip mono">
              {p}
            </li>
          ))}
        </ul>

        <p className="supported-note">
          If a site isn't supported, or the content is private, paywalled, or protected by DRM, FlowFetch will
          tell you clearly rather than pretending it worked.
        </p>
      </div>
    </section>
  );
}
