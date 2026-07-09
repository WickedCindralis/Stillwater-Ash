#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[startup] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

echo "[migrate] Pushing schema to database..."
pnpm --filter @workspace/db run push-force
echo "[migrate] Schema push complete"

export STATIC_DIR="${STATIC_DIR:-/app/artifacts/agent-dashboard/dist/public}"

echo "[startup] Starting Stillwater on port ${PORT:-5000}..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
