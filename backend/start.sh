#!/bin/sh
# Start Cloudflare WARP (userspace wireproxy) in the background for YouTube
# egress, then start the FlowFetch backend in the foreground.
# wireproxy runs WireGuard entirely in userspace (no TUN, no NET_ADMIN,
# no root), so it works inside Render's single container.
# If WARP registration or the health check fails, the backend still starts
# WITHOUT a proxy: other sites still work, and some YouTube videos still
# work direct. YT_PROXY is only exported when warp=on is confirmed.
cd /app/backend 2>/dev/null || true
export YT_PROXY=""
if command -v wgcf >/dev/null 2>&1 && command -v wireproxy >/dev/null 2>&1; then
  rm -f wgcf-profile.conf wgcf-account.toml
  if wgcf register --accept-tos >/tmp/wgcf-register.log 2>&1 && wgcf generate >/tmp/wgcf-generate.log 2>&1; then
    printf '\n[Socks5]\nBindAddress = 127.0.0.1:1080\n' >> wgcf-profile.conf
    wireproxy -c wgcf-profile.conf >/tmp/wireproxy.log 2>&1 &
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if curl -s --socks5-hostname 127.0.0.1:1080 -m 5 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q '^warp=on'; then
        echo "[FlowFetch] WARP is on, YouTube traffic will use the WARP proxy"
        export YT_PROXY="socks5://127.0.0.1:1080"
        break
      fi
      sleep 1
    done
    if [ -z "$YT_PROXY" ]; then
      echo "[FlowFetch] WARP proxy not healthy, starting without proxy"
      pkill -f wireproxy 2>/dev/null || true
    fi
  else
    echo "[FlowFetch] WARP registration failed, starting without proxy"
  fi
fi
exec node dist/server.js
