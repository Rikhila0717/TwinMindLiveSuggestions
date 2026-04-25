#!/bin/sh
# Dev "Run" in Replit: build UI once if missing, then start API.
set -e
cd "$(dirname "$0")"
if [ ! -d frontend/dist ] || [ -z "$(ls -A frontend/dist 2>/dev/null)" ]; then
  (cd frontend && npm ci && npm run build)
fi
python3 -m pip install -q -r requirements.txt
export PORT="${PORT:-8080}"
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
