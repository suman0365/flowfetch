# ─── Stage 1: Build ───
FROM node:20-slim AS build

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# Install all dependencies
RUN npm install --ignore-scripts

# Copy source code
COPY backend/ backend/
COPY frontend/ frontend/
COPY .env.example .env.example

# Build frontend with production API URL (relative to same origin)
ENV VITE_API_URL=/api
RUN npm run build --workspace=frontend

# Build backend (TypeScript → JavaScript)
RUN npm run build --workspace=backend

# Prune devDependencies to keep runtime image minimal
RUN npm prune --omit=dev

# ─── Stage 2: Runtime ───
FROM node:20-slim AS runtime

# Install system dependencies: ffmpeg, python3 (for yt-dlp), ca-certificates, curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      ca-certificates \
      curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/package.json ./package.json

# Copy built backend
COPY --from=build /app/backend/dist/ backend/dist/
COPY --from=build /app/backend/package.json backend/package.json

# Copy built frontend
COPY --from=build /app/frontend/dist/ frontend/dist/

# Create temp directories for downloads
RUN mkdir -p /app/temp/jobs /app/temp/files

# Production environment defaults
ENV NODE_ENV=production
ENV PORT=10000
ENV FRONTEND_URL=*
ENV TEMP_DIR=/app/temp

# Cloud hosts send SIGTERM on shutdown
STOPSIGNAL SIGTERM

# Default port (Render sets $PORT dynamically)
EXPOSE 10000

# Use non-root user for security
RUN groupadd -r flowfetch && useradd -r -g flowfetch -d /app flowfetch && \
    chown -R flowfetch:flowfetch /app
USER flowfetch

# Start the unified server
CMD ["node", "backend/dist/server.js"]

