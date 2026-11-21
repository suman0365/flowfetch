// ---------------------------------------------------------------------------
// Friendly HTML error pages for the download endpoint.
//
// GET /api/download/:jobId is opened directly in the browser (v13.4: it
// plays in Chrome's video player). When the job is gone or the build
// fails, a raw JSON error page confuses the user — so these return a
// plain, mobile-friendly HTML page in Tanglish + English that says what
// happened and what to tap next, with a button back to the site.
// (v13.5, 2026-11-21: Suman opened an old backend link and saw only
// {"success":false,"error":"Download not found or expired."} — he
// thought the backend was broken.)
// ---------------------------------------------------------------------------

const SITE_URL = 'https://flowfetch.vercel.app/';

function page(title: string, heading: string, lines: string[]): string {
  const body = lines.map((l) => `<p>${l}</p>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — FlowFetch</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #111111; color: #ffffff; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 480px; margin: 48px auto; background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 12px; padding: 28px 22px; }
  h1 { font-size: 22px; margin: 0 0 14px; }
  p { color: #cccccc; line-height: 1.6; margin: 0 0 12px; font-size: 16px; }
  a.btn { display: inline-block; margin-top: 14px; background: #ffffff; color: #111111; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 16px; }
</style>
</head>
<body>
<div class="card">
<h1>${heading}</h1>
${body}
<a class="btn" href="${SITE_URL}">Open FlowFetch →</a>
</div>
</body>
</html>`;
}

/** The download link is old — the job/file is gone (kept 1 hour after build). */
export function expiredLinkPage(): string {
  return page('Download link expired', '⏰ Download link expired', [
    'Indha link expire aagiduchu. Server file ah 1 mani neram dhaan vechukkum.',
    'This download link has expired. The file is kept on the server for 1 hour after it is built.',
    'Site ku poitu, video link ah paste pannitu, quality select pannitu, Download ah click pannunga — pudhu link kedaikkum.',
    'Go to FlowFetch, paste the video link, pick a quality, and tap Download for a fresh link.',
  ]);
}

/** The build itself failed (e.g. YouTube blocked the server). */
export function downloadFailedPage(): string {
  return page('Download failed', 'Download failed', [
    'Video download panna mudiyala. Site ku poitu innoru thadava try pannunga.',
    'The download failed. Go back to FlowFetch and try again.',
  ]);
}

/** The disk build is still running — show a page that auto-refreshes until the video is ready. */
export function buildingPage(title: string, resolution?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const label = esc(resolution ? `${title} — ${resolution}` : title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Building your file — FlowFetch</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #111111; color: #ffffff; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 480px; margin: 48px auto; background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 12px; padding: 28px 22px; }
  h1 { font-size: 22px; margin: 0 0 14px; }
  p { color: #cccccc; line-height: 1.6; margin: 0 0 12px; font-size: 16px; }
  .spin { font-size: 32px; display: block; margin-bottom: 12px; animation: spin 1.5s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .file { color: #ffffff; font-weight: 600; }
</style>
</head>
<body>
<div class="card">
<span class="spin">⏳</span>
<h1>Building your file…</h1>
<p class="file">${label}</p>
<p>Video build aagitu irukku — indha page thana refresh aagum, video ready aana ingaye play aagum. Close pannaadha.</p>
<p>Your video is being built — this page refreshes itself, and the video will play right here when it is ready. Please do not close it.</p>
<p>Periya file na konjam neram edukkum. Aprom player la three dots (⋮) ah click panne Download pannikalam.</p>
<p>A large file can take a few minutes. Afterwards, tap the three dots (⋮) in the player to download it.</p>
</div>
</body>
</html>`;
}
