# ─── Stage 1: Build ───
FROM node:20-slim AS build

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# Install all dependencies (including devDependencies for build)
RUN npm install --ignore-scripts

# Copy source code
COPY backend/ backend/
COPY frontend/ frontend/
COPY .env.example .env.example

# Build frontend with production API URL (relative, same origin)
ENV VITE_API_URL=/api
RUN npm run build --workspace=frontend

# Build backend (TypeScript → JavaScript)
RUN npm run build --workspace=backend

# ─── Stage 2: Runtime ───
FROM node:20-slim AS runtime

# Install system dependencies: ffmpeg, python3 + pip (for yt-dlp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      python3-venv && \
    # Install yt-dlp via pip
    python3 -m pip install --no-cache-dir --break-system-packages yt-dlp && \
    # Clean up apt cache to reduce image size
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built backend
COPY --from=build /app/backend/dist/ backend/dist/
COPY --from=build /app/backend/package.json backend/package.json

# Copy built frontend
COPY --from=build /app/frontend/dist/ frontend/dist/

# Copy root package.json for workspace resolution
COPY --from=build /app/package.json package.json

# Install production-only backend dependencies
RUN cd backend && npm install --omit=dev --ignore-scripts

# Create temp directories for downloads
RUN mkdir -p /app/temp/jobs /app/temp/files

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080
ENV FRONTEND_URL=*
ENV TEMP_DIR=/app/temp

# Cloud Run sends SIGTERM on shutdown; give yt-dlp time to clean up
STOPSIGNAL SIGTERM

# Cloud Run expects the container to listen on $PORT (default 8080)
EXPOSE 8080

# Use non-root user for security
RUN groupadd -r flowfetch && useradd -r -g flowfetch -d /app flowfetch && \
    chown -R flowfetch:flowfetch /app
USER flowfetch

# Start the backend (which also serves the frontend in production)
CMD ["node", "backend/dist/server.js"]
