FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl ca-certificates && pip3 install --no-cache-dir --break-system-packages yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV PORT=10000
ENV NODE_ENV=production
ENV TEMP_DIR=/tmp/flowfetch-temp
EXPOSE 10000
CMD ["node", "dist/server.js"]
