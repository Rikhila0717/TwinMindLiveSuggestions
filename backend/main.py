"""
TwinMind Live Suggestions — FastAPI backend.

Routes:
  GET  /                     → serves the frontend shell
  GET  /api/defaults         → default settings seed (models, prompts, windows, temps)
  POST /api/transcribe       → audio chunk → Groq Whisper Large V3 → text
  POST /api/suggestions      → transcript window + priors → GPT-OSS 120B (JSON) → 3 cards
  POST /api/chat             → message + transcript → GPT-OSS 120B (streamed)
  POST /api/export           → full session → JSON or plain text download

The Groq API key is sent in an 'x-groq-key' header on every
non-GET request. Forward to Groq as a Bearer token.
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    PlainTextResponse,
    Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from . import exporter
from .config import defaults_dict
from .groq_client import GroqError, chat_json, chat_stream, transcribe
from .schemas import ChatRequest, ExportRequest, SuggestionsRequest, SuggestionsResponse
from .suggestions import parse_suggestions

# Sometimes a smaller limit returns only 1-2 suggestions
SUGGESTIONS_MAX_TOKENS = 2_200
# Second attempt if the model returned fewer than 3 valid cards.
SUGGESTIONS_RETRY_MAX_TOKENS = 3_600

ROOT = Path(__file__).resolve().parent.parent

FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="TwinMind Live Suggestions", version="1.0.0")

def _require_key(x_groq_key: str | None) -> str:
    key = (x_groq_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=401,
            detail="Missing Groq API key. Paste it in Settings.",
        )
    return key


# ====== API ROUTES ======

@app.get("/api/defaults")
async def api_defaults() -> JSONResponse:
    d = defaults_dict()
    mapped = {
        "transcriptionModel": d["transcription_model"],
        "chatModel": d["chat_model"],
        "chunkSeconds": d["chunk_seconds"],
        "suggestionIntervalSeconds": d["suggestion_interval_seconds"],
        "suggestionContextSeconds": d["suggestion_context_seconds"],
        "topicGapSeconds": d["topic_gap_seconds"],
        "primaryTranscriptSeconds": d["primary_transcript_seconds"],
        "detailAnswerContextSeconds": d["detail_answer_context_seconds"],
        "chatContextSeconds": d["chat_context_seconds"],
        "suggestionHistoryBatches": d["suggestion_history_batches"],
        "suggestionTemperature": d["suggestion_temperature"],
        "detailTemperature": d["detail_temperature"],
        "chatTemperature": d["chat_temperature"],
        "liveSuggestionPrompt": d["live_suggestion_prompt"],
        "detailAnswerPrompt": d["detail_answer_prompt"],
        "chatPrompt": d["chat_prompt"],
    }
    return JSONResponse(mapped)


@app.post("/api/transcribe")
async def api_transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-large-v3"),
    language: str = Form("en"),
    x_groq_key: str | None = Header(default=None, alias="x-groq-key"),
):
    api_key = _require_key(x_groq_key)
    raw = await file.read()
    # Tiny fragment almost certainly = silence. Skip.
    if len(raw) < 1024:
        return {"text": ""}
    try:
        text = await transcribe(
            api_key,
            raw,
            filename=file.filename or "chunk.webm",
            content_type=file.content_type or "audio/webm",
            model=model,
            language=language.strip() or "en",
        )
    except GroqError as e:
        return JSONResponse({"error": e.message}, status_code=e.status)
    return {"text": text}


@app.post("/api/suggestions")
async def api_suggestions(
    body: SuggestionsRequest,
    x_groq_key: str | None = Header(default=None, alias="x-groq-key"),
):
    api_key = _require_key(x_groq_key)

    user_prompt = (
        "RECENT PRIOR SUGGESTIONS (do NOT repeat any of these ideas):\n"
        f"{body.prior_suggestions}\n\n"
        "TRANSCRIPT (most recent window; [mm:ss] is relative to session start):\n"
        f"{body.transcript_window}\n\n"
        "TASK: If the transcript has PRIMARY and EARLIER sections, the 3 "
        "cards must follow the PRIMARY (current/live) topic only. If they "
        "clearly differ in subject, do not mix—ignore EARLIER for card topics. "
        "From the transcript alone, infer what is happening and choose the best "
        "mix of card types for this context. Produce exactly 3 fresh, specific "
        "suggestion cards as JSON per the system prompt. Do not repeat prior "
        "suggestions. Do not output prose."
    )

    t0 = time.monotonic()
    try:
        raw = await chat_json(
            api_key,
            body.model,
            messages=[
                {"role": "system", "content": body.system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=body.temperature,
            max_tokens=SUGGESTIONS_MAX_TOKENS,
        )
    except GroqError as e:
        return JSONResponse({"error": e.message}, status_code=e.status)

    context_type, suggestions = parse_suggestions(raw)
    if 0 < len(suggestions) < 3:
        # Truncation or model skipped a slot — ask once more with a hard nudge.
        fix = (
            "\n\nCRITICAL: Your last JSON was incomplete: `suggestions` must "
            f"be an array of exactly 3 objects (you had {len(suggestions)} valid "
            "item(s) after validation). Each object needs non-empty `title` and "
            "`preview`. Return the full JSON only, no commentary."
        )
        try:
            raw = await chat_json(
                api_key,
                body.model,
                messages=[
                    {"role": "system", "content": body.system_prompt},
                    {"role": "user", "content": user_prompt + fix},
                ],
                temperature=body.temperature,
                max_tokens=SUGGESTIONS_RETRY_MAX_TOKENS,
            )
        except GroqError as e:
            return JSONResponse({"error": e.message}, status_code=e.status)
        m2, s2 = parse_suggestions(raw)
        if len(s2) == 3 or len(s2) > len(suggestions):
            context_type, suggestions = m2, s2

    latency_ms = int((time.monotonic() - t0) * 1000)
    if not suggestions:
        return JSONResponse(
            {"error": "Model returned no usable suggestions", "raw": raw},
            status_code=502,
        )
    return SuggestionsResponse(
        context_type=context_type,
        suggestions=suggestions,
        latency_ms=latency_ms,
    ).model_dump(by_alias=False)


@app.post("/api/chat")
async def api_chat(
    body: ChatRequest,
    x_groq_key: str | None = Header(default=None, alias="x-groq-key"),
):
    api_key = _require_key(x_groq_key)

    # System message: configured prompt + a fresh transcript snapshot.
    # Packing the transcript into the system message (not a user turn)
    # means it refreshes every turn without polluting conversation history.
    system_content = (
        f"{body.system_prompt}\n\n"
        "====== MEETING TRANSCRIPT (most recent window; [mm:ss] relative to session start) ======\n"
        f"{body.transcript_window or '(no transcript yet — speak to record)'}"
    )
    messages: list[dict] = [{"role": "system", "content": system_content}]
    for h in body.history:
        messages.append({"role": h.role, "content": h.content})

    if body.suggestion_card:
        card = body.suggestion_card
        final_user_parts = [
            "I tapped this suggestion card. Expand it per the type-specific "
            "instructions in the system prompt:",
            "",
            f"type: {card.type}",
            f"title: {card.title}",
            f"preview: {card.preview}",
        ]
        if card.reasoning:
            final_user_parts.append(f"why_now: {card.reasoning}")
        if body.user_message:
            final_user_parts.append("")
            final_user_parts.append(f"Extra note from me: {body.user_message}")
        final_user = "\n".join(final_user_parts)
    else:
        final_user = body.user_message

    messages.append({"role": "user", "content": final_user})

    async def token_stream():
        try:
            async for delta in chat_stream(
                api_key,
                body.model,
                messages,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
            ):
                yield delta.encode("utf-8")
        except GroqError as e:
            yield f"\n\nERROR: {e.message}".encode("utf-8")

    return StreamingResponse(
        token_stream(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/export")
async def api_export(body: ExportRequest) -> Response:
    if body.format == "text":
        return PlainTextResponse(exporter.export_as_text(body))
    return PlainTextResponse(
        exporter.export_as_json(body), media_type="application/json"
    )


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


# ====== Frontend ======


if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/")
    async def index(_: Request) -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    async def spa_catchall(full_path: str) -> Response:
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    async def index_dev() -> JSONResponse:
        return JSONResponse(
            {
                "status": "dev",
                "message": (
                    "frontend/dist not built. Run 'cd frontend && npm run dev' "
                    "(served separately on :5173) or 'npm run build' to produce "
                    "dist/ that this server will serve on :8000."
                ),
            }
        )
