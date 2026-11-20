FROM node:20-slim

# yt-dlp needs Python, FFmpeg is needed to merge video+audio
# Install Deno: Deno is yt-dlp's default JavaScript runtime. Node alone did not get past YouTube's bot check, so Deno is installed for yt-dlp to solve YouTube's JavaScript challenges.
# wgcf+wireproxy give a Cloudflare WARP egress (userspace WireGuard, no TUN/root) so YouTube sees a Cloudflare IP instead of Render's flagged datacenter IP.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg curl ca-certificates unzip procps \
    && pip3 install --no-cache-dir --break-system-packages -U yt-dlp yt-dlp-ejs \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && deno --version \
      && curl -fsSL https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_amd64 -o /usr/local/bin/wgcf \
        && chmod +x /usr/local/bin/wgcf \
          && curl -fsSL https://github.com/pufferffish/wireproxy/releases/download/v1.0.9/wireproxy_linux_amd64.tar.gz -o /tmp/wireproxy.tgz \
            && tar xzf /tmp/wireproxy.tgz -C /usr/local/bin wireproxy \
              && rm -f /tmp/wireproxy.tgz \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY start.sh ./
RUN npm run build && npm prune --omit=dev

# Render sets PORT itself; keep a default for local runs
ENV PORT=10000
ENV NODE_ENV=production
ENV TEMP_DIR=/tmp/flowfetch-temp

EXPOSE 10000
CMD ["sh", "./start.sh"]
