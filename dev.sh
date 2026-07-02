#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ] || [ ! -d psyche-seek/node_modules ]; then
  ./build.sh
fi

WEB_PORT="${WEB_PORT:-7007}"
VITE_PORT="${VITE_PORT:-5173}"

for port in "$WEB_PORT" "$VITE_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
    echo "Port $port is already in use" >&2
    exit 1
  fi
done

cleanup() {
  local pid
  pid=$(lsof -t -iTCP:"$WEB_PORT" -sTCP:LISTEN || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

WEB_PORT="$WEB_PORT" .venv/bin/python pseek -d "$@" &

cd psyche-seek
VITE_DAEMON_PORT="$WEB_PORT" npm run dev -- --port "$VITE_PORT" --strictPort
