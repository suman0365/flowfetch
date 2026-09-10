#!/usr/bin/env bash
set -e

# Install ALL deps including devDependencies (needed for TypeScript compilation)
# Render sets NODE_ENV=production which would skip devDeps otherwise
npm install --include=dev

# Compile TypeScript
npm run build

# Install yt-dlp binary into PATH
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

# Verify ffmpeg (pre-installed on Render's Linux environment)
ffmpeg -version 2>&1 || echo 'WARNING: ffmpeg not found'

echo 'Build complete.'
