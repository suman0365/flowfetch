# FlowFetch — Universal Video Downloader

FlowFetch is a complete, production-ready full-stack web application for downloading publicly accessible media. It provides a beautiful, modern React frontend to seamlessly interact with `yt-dlp` and `FFmpeg` through a secure Node.js backend.

## 🚀 Features
- **Modern UI**: Clean, premium design with Dark/Light mode support.
- **Format Selection**: Analyze any supported URL and pick between Video+Audio, Audio Only, or Video Only.
- **Real-Time Progress**: Uses Server-Sent Events (SSE) to stream download progress and ETA.
- **Safe & Secure**: Backend safely spawns processes, validates inputs, and automatically cleans up temporary files.

---

## 🛠 Prerequisites for Windows

Before you start, ensure you have the following installed and accessible in your system `PATH`:

1. **Node.js** (v18+ recommended): [Download Node.js](https://nodejs.org/)
2. **yt-dlp**: 
   - [Download yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases)
   - Place it in a folder (e.g., `C:\bin`) and add that folder to your system Environment Variables `PATH`.
3. **FFmpeg**:
   - [Download FFmpeg Windows Build](https://gyan.dev/ffmpeg/builds/)
   - Extract and add the `bin` folder to your system `PATH`.

---

## ⚙️ Installation & Setup

1. **Install all dependencies** from the root folder:
   ```powershell
   npm run install:all
   ```

2. **Configure Environment Variables**:
   Copy the example config in the root to the backend folder:
   ```powershell
   Copy-Item -Path .env.example -Destination backend\.env
   ```
   *(Optional)* Edit `backend/.env` to configure ports, limits, or temporary directories.

---

## 🏃‍♂️ Development Mode

Start both the backend and frontend concurrently in development mode:

```powershell
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000/api

---

## 📦 Production Build

To build the application for production, run from the root:

```powershell
npm run build
```

Then, you can start the production backend:
```powershell
npm start
```
*(You will need to serve the `frontend/dist` folder using a static server like Nginx, or configure Express to serve static files).*

---

## 📁 Project Structure

```
flowfetch/
├── frontend/           # React + Vite + TypeScript (Vanilla CSS UI)
├── backend/            # Node.js + Express (yt-dlp wrapper, SSE, rate limiting)
├── temp/               # Managed temporary files and downloads
├── .env.example        # Environment variable template
└── package.json        # Root scripts
```

## ⚖️ Legal Disclaimer
Download only content you have permission to download. FlowFetch does not bypass DRM, paywalls, or access controls.
