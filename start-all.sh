#!/bin/sh
set -eu

echo "Starting QA API on :8000"
bun run start &
API_PID=$!

echo "Starting Next frontend on :3000"
cd /app/frontend
npm run start &
WEB_PID=$!
cd /app

echo "Starting Caddy edge proxy on :8080"
caddy run --config /app/Caddyfile --adapter caddyfile &
CADDY_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" "$CADDY_PID" 2>/dev/null || true
}
trap cleanup INT TERM

wait -n "$API_PID" "$WEB_PID" "$CADDY_PID"
cleanup
