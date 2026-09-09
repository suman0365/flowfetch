# FlowFetch — Universal Video Downloader

**Paste. Choose. Download.**

FlowFetch is a full-stack web app for downloading publicly accessible video
and media URLs. Paste a link, FlowFetch analyzes it with `yt-dlp`, you pick a
format, and it downloads the file — with a real progress stream, real error
states, and automatic cleanup of temporary files.

FlowFetch does **not** bypass DRM, paywalls, authentication, or any other
technical access control. If content is protected or unavailable, it shows a
clear error instead.

## Project structure

```
flowfetch/
├── frontend/          React + Vite + TypeScript UI
├── backend/           Node + Express + TypeScript API
│   ├── src/
│   │   ├── routes/        analyze, download, progress (SSE)
│   │   ├── services/      yt-dlp wrapper, downloader, ffmpeg check, cleanup
│   │   ├── middleware/     validation, rate limiting, error handling
│   │   ├── utils/          SSRF-safe URL validation, logging
│   │   └── config/
│   └── temp/          Job working directories (gitignored, auto-cleaned)
├── .env.example
└── package.json       Root workspace scripts
```

## Technologies used

- **Frontend:** React 18, Vite, TypeScript, plain CSS (no framework) — light/dark theme, SSE-driven progress UI
- **Backend:** Node.js, Express, TypeScript, [`yt-dlp`](https://github.com/yt-dlp/yt-dlp), FFmpeg
- **Transport:** REST for analyze/download, Server-Sent Events for progress
- **Security:** SSRF-safe URL validation, `child_process.spawn` with argv arrays (never shell strings), strict format-id and job-id validation, path-traversal defense on file serving, IP rate limiting, request body size limits, process timeouts, automatic temp-file expiry

## Required external installations

FlowFetch's backend shells out to two external tools that are **not**
installed via npm and must be present on `PATH`:

1. **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — the extraction engine
2. **[FFmpeg](https://ffmpeg.org/download.html)** — used by yt-dlp to merge
   separate video/audio streams and to remux/extract audio

If either is missing, FlowFetch fails gracefully with a clear error rather
than crashing — `GET /api/health` reports whether FFmpeg was detected at
startup, and `yt-dlp` calls report `EXTRACTOR_UNAVAILABLE` if it isn't found.

## Windows setup

Run these in PowerShell.

1. **Install Node.js** (v18.18+): download from [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS`
2. **Install yt-dlp:**
   ```powershell
   winget install yt-dlp.yt-dlp
   ```
   or download `yt-dlp.exe` from the [releases page](https://github.com/yt-dlp/yt-dlp/releases) and add it to your `PATH`.
3. **Install FFmpeg:**
   ```powershell
   winget install Gyan.FFmpeg
   ```
   or download a build from [ffmpeg.org](https://ffmpeg.org/download.html#build-windows) and add its `bin` folder to `PATH`.
4. **Verify both are on PATH:**
   ```powershell
   yt-dlp --version
   ffmpeg -version
   ```
5. **Install project dependencies** (from the repo root):
   ```powershell
   npm install
   npm run install:all
   ```
6. **Configure environment:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Adjust values in `.env` if needed (defaults work for local development).
7. **Start the backend** (new terminal):
   ```powershell
   cd backend
   npm run dev
   ```
8. **Start the frontend** (new terminal):
   ```powershell
   cd frontend
   npm run dev
   ```
   Or, from the repo root, run both together: `npm run dev`.
9. **Open the app:** http://localhost:5173

macOS/Linux: same steps, using `brew install yt-dlp ffmpeg` (macOS) or your
distro's package manager instead of `winget`.

## Development commands

```bash
npm install              # installs root workspace tooling
npm run install:all      # installs backend + frontend dependencies
npm run dev               # runs backend (port 4000) and frontend (port 5173) together
```

Or individually:

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

## Production build

```bash
npm run build             # builds backend (tsc) and frontend (vite build)
npm start                 # starts the compiled backend (serves the API)
```

The frontend build output lands in `frontend/dist/` — serve it with any
static host or reverse proxy pointed at the backend's `/api` routes.

## Environment variables

See `.env.example` at the repo root. Key ones:

| Variable | Purpose |
|---|---|
| `PORT` | Backend port (default `4000`) |
| `FRONTEND_URL` | Allowed CORS origin |
| `TEMP_DIR` | Where in-progress and completed downloads are stored |
| `MAX_FILE_SIZE` | Hard byte ceiling per download |
| `DOWNLOAD_TIMEOUT` | Max ms a single download may run before being killed |
| `FILE_RETENTION_MS` | How long a completed file stays before auto-deletion |
| `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX` | IP-based rate limiting |
| `VITE_API_URL` | API base URL the frontend calls |

## Testing performed

- Automated: `npm test` (from `backend/`) runs Node's built-in test runner
  against URL/SSRF validation, request validation (including rejection of
  shell-metacharacter and path-traversal input), and the job store's
  duplicate-job and completion/failure logic.
- Manual review: traced the full analyze → select format → download → SSE
  progress → complete flow end-to-end through the code, and reviewed every
  route for input validation, error handling, and path safety.

**Not performed in this environment:** this project was generated in a
sandbox with no network access, so `npm install`, an actual `yt-dlp`/`ffmpeg`
invocation, and a live `vite build`/dev-server run could not be executed
here. Before relying on this in production, run `npm run install:all`,
`npm test`, `npm run dev`, and a manual download against a real public video
URL on your own machine.

## Known limitations

- Job and progress state is held in memory — restarting the backend loses
  in-flight jobs (completed files on disk are still cleaned up by the
  orphan sweep on the next run).
- Single-process only; horizontal scaling would need a shared job store
  (e.g. Redis) instead of the in-memory `Map` used here.
- Site coverage depends entirely on the installed version of `yt-dlp` —
  keep it updated (`yt-dlp -U`) as sites change their pages.
