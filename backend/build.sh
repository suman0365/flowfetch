#!/usr/bin/env bash
set -e

npm install
npm run build

curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

ffmpeg -version 2>&1 || true

echo Build complete
