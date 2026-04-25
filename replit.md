# TwinMind — Live Meeting Copilot

## Overview
A real-time meeting copilot that listens to live audio, transcribes it using Groq's Whisper Large V3, and generates context-aware suggestions every 30 seconds using LLMs via the Groq API. Users can interact with suggestions or chat directly about the meeting.

## Architecture
- **Backend**: Python 3.12 + FastAPI (port 8000, localhost)
- **Frontend**: React 18 + TypeScript + Vite (port 5000, 0.0.0.0)
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **AI**: Groq API (Whisper Large V3 for transcription, GPT-OSS 120B / Llama 3 for suggestions)

## Project Layout
```
backend/         # FastAPI application
  main.py        # API routes and SPA serving
  config.py      # Default settings
  groq_client.py # Groq API integration
  prompts.py     # LLM system prompts
  schemas.py     # Pydantic models
  suggestions.py # Suggestion parsing
  exporter.py    # Session export (JSON/text)
frontend/        # React + Vite app
  src/
    components/  # UI components
    lib/         # Audio recording, API client, markdown
    App.tsx      # Main orchestrator
    store.ts     # Zustand state stores
    types.ts     # TypeScript interfaces
  vite.config.ts # Dev server on port 5000, proxies /api to :8000
pyproject.toml   # Python dependencies (pip)
```

## Workflows
- **Start application**: `cd frontend && npx vite --host 0.0.0.0 --port 5000` (webview, port 5000)
- **Backend API**: `python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` (console)

## Deployment
- Build: `bash -c "cd frontend && npm ci && npm run build && cd .. && pip install -e ."`
- Run: `python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 5000`
- Target: autoscale (FastAPI serves the built frontend assets)

## Key Details
- The Groq API key is entered by the user in the Settings UI and stored in browser localStorage
- Audio is recorded in 30-second chunks using the Web Audio API / MediaRecorder
- Chat responses use SSE streaming via FastAPI StreamingResponse
- The frontend Vite dev server proxies `/api` and `/healthz` to the backend at localhost:8000
