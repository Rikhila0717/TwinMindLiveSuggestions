# TwinMind — Live Suggestions (Python / FastAPI)

A web app that listens to live audio from your microphone, transcribes it
in 30 second chunks, and every 30 seconds surfaces 3 context-aware suggestions - for what you should say, ask, know, or double-check — right now, while the conversation is still happening. Tap
any card to get the expanded answer in the chat on the right, or type
your own question.


**Backend:** Python. FastAPI
**Transcription:** Groq - Whisper Large V3
**Suggestions + detail answers + chat:** Groq - `openai/gpt-oss-120b`
**Frontend:** Vite, React 18, TypeScript, Tailwind, Zustand
**Key handling:** user-supplied at runtime, stored only in their browser

======

## Quick start (local)

### Option A — one-shot (build once, serve from FastAPI)

```bash
git clone <this repo>
cd twinmind
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Build the React app into frontend/dist (one-time unless you edit UI)
cd frontend && npm install && npm run build && cd ..

uvicorn backend.main:app --reload
# open http://localhost:8000
```

### Option B — dev mode (hot reload on both sides)

```bash
# Terminal 1 — API server
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — Vite dev server with /api proxy to :8000
cd frontend
npm install
npm run dev
# open http://localhost:5173
```


### Local Docker 

Same image the Dockerfile builds:

```bash
docker build -t twinmind .
docker run --rm -p 8000:8000 twinmind
# http://localhost:8000
```


Vite proxies `/api/*` and `/healthz` to the FastAPI server, so the
browser sees a single origin and the `x-groq-key` header flows cleanly.

On first load, user is prompted for a **Groq API key** (
<https://console.groq.com/keys>). The key is saved only in the browser's `localStorage` and is forwarded to the FastAPI backend on every request via the `x-groq-key` header. The backend attaches it as a Bearer token on the call to Groq — nothing is persisted server-side, nothing is logged.

No env vars are required to run the app.

### GitHub Actions (CI for Replit)

## Deploy (Replit) — one URL, no Docker

=====

## Stack & layout

```
backend/
  main.py            FastAPI app (routes + SPA mount)
  config.py          AppDefaults dataclass (models, prompts, windows, temps)
  prompts.py         The three prompts (LIVE / DETAIL / CHAT)
  schemas.py         Pydantic request/response models
  groq_client.py     Async Groq client (transcribe / JSON / stream) via httpx
  suggestions.py     JSON parse + sanitise for the 3-card batch
  exporter.py        Session export to JSON / plain text
frontend/
  package.json       Vite + React + TS + Tailwind + Zustand
  vite.config.ts     /api proxy to :8000 in dev, static bundle in prod
  index.html         App shell
  src/
    main.tsx         React entry
    App.tsx          Orchestrator: recording, timer, API, chat
    store.ts         Zustand stores (transcript / suggestions / chat / settings)
    types.ts
    lib/
      audio.ts       Rolling chunked MediaRecorder
      api.ts         Typed client for /api/*
      context.ts     Transcript-window + anti-repeat block builders
      md.ts          Tiny markdown renderer for streamed output
      export.ts      Triggers server-side export + file download
    components/
      Header.tsx
      TranscriptPanel.tsx
      SuggestionsPanel.tsx
      ChatPanel.tsx
      SettingsModal.tsx
pyproject.toml        Python package metadata and dependencies (PEP 621)
Dockerfile            (multi-stage: node build → python runtime)
start-replit.sh     (Replit: build + `uvicorn` on `$PORT`, no Docker)
.github/workflows/replit.yml  (CI; optional `REPLIT_DEPLOY_HOOK` for deploy ping)
```

Three panels drive the whole UX:

| Column | What it does |
|---|---|
| **Transcript** (left) | Start/stop mic, renders incoming chunks with `[mm:ss]` timestamps, auto-scrolls, "transcribing…" indicator while a chunk is in flight. |
| **Live suggestions** (middle) | Newest batch on top (3 cards), older batches persist below. Each card is type-tagged (answer / fact-check / question / talking point / clarify / action), with a short preview that already delivers value. `contextType` chip shown next to the title. |
| **Chat** (right) | Streams GPT-OSS 120B token-by-token for detail answers (on card click) and typed questions. Markdown rendering, time-to-first-token displayed. |

The Export button in the header hits the backend's `/api/export` with
the full session state and downloads either JSON or plain text with
timestamps relative to session start. This is the file the TwinMind team
uses to evaluate submissions.

---

## Prompt strategy

All three prompts live in `backend/prompts.py` and are editable at runtime in
**Settings → Prompts** — changes are persisted to localStorage and take
effect on the next request.

### 1. Live-suggestion prompt (`LIVE_SUGGESTION_PROMPT`)

Runs every 30s. Produces exactly 3 cards as strict JSON (Groq's
`response_format: { type: "json_object" }` enforces that server-side).

Key decisions:

- Each card must pick from a fixed set:
  `answer`, `fact_check`, `question`, `talking_point`, `clarify`,
  `action`, `risk`. This is what lets the UI colour-code cards, and more
  importantly it forces the model to think about what kind of help is
  needed right now* instead of defaulting to "ask a question" three
  times.

- **Urgency rules encoded directly in the prompt.** If the transcript
  has an unanswered question, the model is told to ANSWER IT as card
  #1. If a factual claim was just made that looks shaky, fact-check
  it with the correct info inline. If jargon appeared, clarify.
  Otherwise mix talking points / probing questions / actions.

- **The preview summarizes the suggestion.** The prompt tells the model that the
  short preview must be independently useful — for `answer` and
  `fact_check` the actual answer / correction goes in the preview, not
  "click to see more". This is what makes the middle column valuable
  even when the user never clicks.

- **Anti-repeat context.** Titles + previews of the last N batches are
  passed as a "do NOT repeat any of these ideas" block. This is the
  single biggest quality improvement for long meetings — without it,
  the model re-proposes the same talking point three batches in a row.

- **Transcript goes last.** In the user turn, prior-suggestions come
  first and transcript comes last, followed by a one-line restatement
  of the task. Transcript in the tail of the prompt lands in the
  model's strongest attention zone, and the restatement re-anchors the
  model on the output schema. See the user-prompt template in
  `backend/main.py::api_suggestions`.

- **Timestamps on transcript lines.** Every line is prefixed with
  `[mm:ss]` relative to session start. The model can reason about
  *recency* — a question asked 10s ago is more urgent than one from
  2 min ago — without having to hand-wave about "the recent part".

- **`contextType` field.** The model labels the meeting
  (`"sales discovery"`, `"technical design review"`, etc.) before
  picking cards. Committing to a label subtly nudges suggestions to
  fit that context type.

- **Empty-transcript fallback.** If the transcript is silence or one
  word, the model is told to return gentle onboarding prompts and
  label the meeting `"unclear"`.

### 2. Detail-answer prompt (`DETAIL_ANSWER_PROMPT`)

Runs when a card is clicked. Streams markdown. Gets a wider transcript
window (default 15 min vs. 3 min for live).

Key decisions:

- **Type-specialised formatting.** The prompt branches on the card's
  type: an `answer` gets a full answer + reasoning; a `fact_check`
  gets "claimed vs. actually true + why"; a `question` gets the
  best-phrased version plus 2–3 follow-up probes; a `talking_point`
  gets the point plus one concrete example; etc. The user gets
  something tailored to *what they tapped on*, not a generic essay.
- **Grounded in transcript.** Quoting sparingly with `>` blockquotes
  is encouraged, padding is not. Word budget: ≤250 words unless depth
  is genuinely needed.
- **No filler openers.** "Great question!", "Sure!", "As an AI…" are
  explicitly banned. Lead with the actual answer.

The clicked card itself is passed to the API as a structured payload
(`type`, `title`, `preview`, `reasoning`), and `/api/chat` wraps it in
a user turn that says "I tapped this card — expand it per the
type-specific rules in the system prompt". The prompt doesn't have to
guess, it's explicitly told to the LLM.

### 3. Chat prompt (`CHAT_PROMPT`)

Runs on typed questions. Gets the widest transcript window (default
30 min).

- **Anchor in transcript when the question touches the meeting**,
  otherwise answer from general knowledge and note briefly that it's
  outside the meeting context.

- **Draft-don't-describe rule.** If the user is clearly drafting
  (email, summary, message, brief), return the *draft itself*, not
  advice about how to draft one. This is the single most common
  failure mode for these assistants, so it's called out directly.
- Full conversation history is maintained client-side and passed as
  `history[]`. The transcript is refreshed on every turn via the
  system message (not re-sent as user turns), which keeps the context
  lean.

### Why these choices


- **Temperatures:** 0.55 for suggestions (we *want* variety across the
  3 cards and across batches), 0.35 for detail answers (grounded),
  0.4 for chat (a small amount of voice warmth).
- **Context windows** are all configurable in Settings. Defaults keep
  prompts small (latency + cost) while retaining the current "thread"
  of conversation for live cards, and the full meeting for chat.

---

## Audio / chunking tradeoffs

The obvious thing to do — run a single `MediaRecorder` with
`timeslice: 30000` and ship each `dataavailable` blob to Whisper —
doesn't work: only the first blob has a valid WebM header; subsequent
ones are mid-stream fragments and Groq's Whisper endpoint (correctly)
rejects them.

Options I considered:

1. **Record continuously, decode + re-encode each slice via Web Audio
   / ffmpeg-wasm.** Heavy dep, CPU hit, cold-start of wasm hurts
   first-chunk latency.

2. **Two overlapping `MediaRecorder`s that swap.** Near-zero gap but
   the code gets hairy and doubles CPU.

3. **Tear down + recreate the `MediaRecorder` every 30 s on the same
   `MediaStream`.** Each new blob is a complete, self-contained WebM
   file. Gap between recorders is a handful of milliseconds —
   inaudible in practice, and transcription is chunked anyway so it
   doesn't matter.

I went with (3). See `frontend/src/lib/audio.ts` (`ChunkedRecorder`).
The `stop()` / `onstop` callback flushes the chunk to the backend,
then immediately spawns a fresh recorder if the user is still
recording. The `MediaStream` (mic permission, device selection) is
held across chunks, so there's only one permission prompt.

The manual **Refresh** button uses the same mechanism
(`ChunkedRecorder.flushAndRestart()`): it stops the current recorder
(forcing the in-flight chunk to flush through transcription) and
fires a suggestions call immediately — "manually updates transcript
then suggestions if tapped" exactly as the spec requires.

A `file.size < 1024` short-circuit in `/api/transcribe` skips
essentially-silent fragments. Small, but useful for long sessions.

======

## Latency budget

Measured on my laptop against a warm Groq endpoint:

| Event | Typical |
|---|---|
| Stop mic → chunk POSTed | 10 ms |
| `/api/transcribe` round-trip (30 s WebM) | 500–900 ms |
| Suggestions: click Refresh → JSON rendered | 800–1400 ms |
| Chat: send → first token rendered | 300–700 ms |
| Reload → first suggestions rendered (with 8 s head-start timer) | 9–11 s (bounded by the first transcript chunk) |

Things that help:

- **Streaming chat.** `/api/chat` uses `httpx.AsyncClient.stream` to
  consume Groq's SSE and re-emits it as a plain text stream of token
  deltas (`StreamingResponse`) — simpler for the client, no SSE
  parsing in the browser. The UI renders tokens as they arrive with a
  blinking caret.

- **Non-blocking transcription.** Transcription is kicked off from
  `MediaRecorder.onstop` and never blocks the recording loop, so the
  user can keep talking while chunks are in flight.

- **Small prompts.** The default 3-minute context window for live
  suggestions usually keeps transcripts under a few hundred tokens.
  This matters more than you'd think for *consistency*, not just
  latency — a smaller window keeps the model focused on what's
  happening *now*.

- **Async everywhere.** FastAPI + httpx means a single worker handles
  concurrent transcribe / suggestion / chat calls without blocking.

======

## Handling failure

- **Bad key / 401:** API routes return `{"error": "..."}` with status
  401; the UI surfaces the message inline and pops Settings open on
  mic start.

- **Transcription error:** shown as a red inline banner in the
  transcript column; does not stop recording.

- **Suggestion error:** shown at the top of the suggestions column;
  the auto-refresh timer keeps running so the next attempt self-heals.

- **Chat error:** surfaced in-stream as a `<error>` line so the
  chat thread stays coherent and the user can retry.

- **Malformed JSON from the model:** `backend/suggestions.py` falls
  back to extracting the largest `{...}` substring before giving up,
  and each card is defensively normalised (allowed types, non-empty
  title/preview, max 3 items).

- **Empty transcript:** the live-suggestion prompt has an explicit
  "onboarding fallback" clause so the first batch is never junk.

======

## API reference

| Route | Method | Body | Purpose |
|---|---|---|---|
| `/api/defaults` | GET | — | Default settings the frontend seeds from on first load. |
| `/api/transcribe` | POST | multipart (`file`, `model`) | Audio chunk → Groq Whisper → `{text}`. |
| `/api/suggestions` | POST | JSON `SuggestionsRequest` | Transcript + priors → GPT-OSS 120B (JSON mode) → 3 cards. |
| `/api/chat` | POST | JSON `ChatRequest` | Message + transcript → GPT-OSS 120B → **streamed** text. |
| `/api/export` | POST | JSON `ExportRequest` | Full session → JSON or plain text download. |
| `/healthz` | GET | — | Liveness check. |
| `/` and `/assets/*` | GET | — | Built React app (Vite bundle) served from `frontend/dist`. |

All non-GET routes require the `x-groq-key` header.

======


## What I'd build next, enhancing current TwinMind's Live Suggestions:



======

## Licence

MIT. Built for the TwinMind Live Suggestions assignment, April 2026.
