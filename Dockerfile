# ── Stage 1: build the React frontend ────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /web

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ──────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml .
COPY backend ./backend
RUN pip install --no-cache-dir .
COPY --from=frontend-build /web/dist ./frontend/dist

EXPOSE 8000

# Fly.io sets PORT; local runs default to 8000.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
