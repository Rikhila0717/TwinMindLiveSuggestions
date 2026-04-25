"""
Thin async Groq client built on httpx.

The browser passes the user-supplied key on
every request via the `x-groq-key` header; these helpers forward it to
Groq as a Bearer token. Key is never logged.

"""

from __future__ import annotations

import json
from typing import AsyncIterator, Iterable

import httpx

from .config import GROQ_BASE_URL
from .whisper_segment_filter import should_keep_whisper_segment


def _clean_stt(text: str) -> str:
    """Normalize final transcript string (no segments path and post-join)."""
    return (text or "").strip()


class GroqError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


async def _safe_error_message(resp: httpx.Response) -> str:
    try:
        j = resp.json()
        return (j.get("error", {}) or {}).get("message") or f"{resp.status_code} {resp.reason_phrase}"
    except Exception:
        return f"{resp.status_code} {resp.reason_phrase}"


def _transcript_from_verbose_json(payload: dict) -> str:
    """
    'verbose_json' per-segment fields (no_speech_prob, avg_logprob,
    compression_ratio) to filter junk — 'whisper_segment_filter' —
    addresses some possible hallucination strings.
    """
    text = (payload.get("text") or "").strip()
    segments = payload.get("segments")
    if not isinstance(segments, list) or not segments:
        return _clean_stt(text)
    kept: list[str] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        t = (seg.get("text") or "").strip()
        if t and should_keep_whisper_segment(seg):
            kept.append(t)
    # When segments exist, only use kept text — the top-level `text` can still
    # contain hallucination from dropped segments.
    joined = " ".join(kept).strip()
    return _clean_stt(joined)


async def transcribe(
    api_key: str,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    model: str,
    *,
    language: str = "en",
) -> str:
    """Returns the transcript text, or '' on empty audio.

    'language' code passed to Groq/Whisper. It strongly reduces
    other-language hallucinations (Arabic phrases on silence/background noise)
    at the cost of being wrong if the user actually speaks in another language.
    Can omit language="" to let the model auto-detect.
    """
    files = {"file": (filename, audio_bytes, content_type)}
    data: dict[str, str] = {
        "model": model,
        "response_format": "verbose_json",
        "temperature": "0",
    }
    if language and language.lower() not in ("auto", "detect", ""):
        data["language"] = language
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{GROQ_BASE_URL}/audio/transcriptions",
            headers=_auth_headers(api_key),
            files=files,
            data=data,
        )
        if resp.status_code >= 400:
            raise GroqError(resp.status_code, await _safe_error_message(resp))
        payload = resp.json()
        if not isinstance(payload, dict):
            return ""
        try:
            return _transcript_from_verbose_json(payload)
        except (TypeError, KeyError, ValueError):
            return _clean_stt(payload.get("text") or "")


async def chat_json(
    api_key: str,
    model: str,
    messages: Iterable[dict],
    *,
    temperature: float = 0.4,
    max_tokens: int = 900,
) -> str:
    """Single-shot JSON-mode chat completion. Returns the raw content string."""
    body = {
        "model": model,
        "messages": list(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(
            f"{GROQ_BASE_URL}/chat/completions",
            headers={**_auth_headers(api_key), "Content-Type": "application/json"},
            json=body,
        )
        if resp.status_code >= 400:
            raise GroqError(resp.status_code, await _safe_error_message(resp))
        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise GroqError(502, "Groq returned an unexpected response shape")


async def chat_stream(
    api_key: str,
    model: str,
    messages: Iterable[dict],
    *,
    temperature: float = 0.4,
    max_tokens: int = 1200,
) -> AsyncIterator[str]:
    """
    Async iterator of token-delta strings. Parses Groq's SSE stream and
    yields only the 'choices[0].delta.content' pieces — the client just
    needs to concatenate them.
    """
    body = {
        "model": model,
        "messages": list(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{GROQ_BASE_URL}/chat/completions",
            headers={**_auth_headers(api_key), "Content-Type": "application/json"},
            json=body,
        ) as resp:
            if resp.status_code >= 400:
                # Surface the error body to the caller.
                raw = await resp.aread()
                try:
                    msg = (json.loads(raw).get("error", {}) or {}).get(
                        "message"
                    ) or f"{resp.status_code} {resp.reason_phrase}"
                except Exception:
                    msg = f"{resp.status_code} {resp.reason_phrase}"
                raise GroqError(resp.status_code, msg)

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    return
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = obj["choices"][0]["delta"].get("content")
                except (KeyError, IndexError, TypeError):
                    delta = None
                if delta:
                    yield delta
