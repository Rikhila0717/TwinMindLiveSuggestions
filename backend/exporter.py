"""
Server-side session export. The frontend also exports JSON/text locally.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from .schemas import ExportRequest


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _rel(ms: int, t0: int) -> str:
    sec = max(0, (ms - t0) // 1000)
    return f"{sec // 60:02d}:{sec % 60:02d}"


def export_as_json(req: ExportRequest) -> str:
    t0 = req.session_started_at
    payload = {
        "exportedAt": datetime.now(tz=timezone.utc).isoformat(),
        "sessionStartedAt": _iso(t0),
        "transcript": [
            {
                "startedAt": _iso(s.started_at),
                "endedAt": _iso(s.ended_at),
                "relativeStart": _rel(s.started_at, t0),
                "text": s.text,
            }
            for s in req.transcript
        ],
        # Batches come in from the UI with newest-first. Export chronologically.
        "suggestionBatches": [
            {
                "createdAt": _iso(b.created_at),
                "relativeTime": _rel(b.created_at, t0),
                "contextType": b.context_type,
                "latencyMs": b.latency_ms,
                "suggestions": [
                    {
                        "type": s.type,
                        "title": s.title,
                        "preview": s.preview,
                        "reasoning": s.reasoning,
                    }
                    for s in b.suggestions
                ],
            }
            for b in reversed(req.batches)
        ],
        "chat": [
            {
                "createdAt": _iso(m.created_at),
                "relativeTime": _rel(m.created_at, t0),
                "role": m.role,
                "content": m.content,
                "triggeredBy": (
                    {
                        "type": m.triggered_by.type,
                        "title": m.triggered_by.title,
                        "preview": m.triggered_by.preview,
                    }
                    if m.triggered_by
                    else None
                ),
                "timeToFirstTokenMs": m.ttft_ms,
            }
            for m in req.chat
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


def export_as_text(req: ExportRequest) -> str:
    t0 = req.session_started_at
    lines: list[str] = []
    lines.append("TwinMind Live Suggestions — Session Export")
    lines.append(f"Exported: {datetime.now(tz=timezone.utc).isoformat()}")
    lines.append(f"Session started: {_iso(t0)}")
    lines.append("")

    lines.append("====== TRANSCRIPT ======")
    if not req.transcript:
        lines.append("(empty)")
    for s in req.transcript:
        lines.append(f"[{_rel(s.started_at, t0)}] {s.text}")
    lines.append("")

    lines.append("====== SUGGESTION BATCHES (chronological) ======")
    if not req.batches:
        lines.append("(none)")
    for b in reversed(req.batches):
        lines.append("")
        lines.append(
            f"Batch @ {_rel(b.created_at, t0)} · contextType={b.context_type or '?'} "
            f"· latency={b.latency_ms if b.latency_ms is not None else '?'}ms"
        )
        for i, s in enumerate(b.suggestions, start=1):
            lines.append(f"  {i}. [{s.type}] {s.title}")
            lines.append(f"     {s.preview}")
            if s.reasoning:
                lines.append(f"     why: {s.reasoning}")
    lines.append("")

    lines.append("====== CHAT ======")
    if not req.chat:
        lines.append("(empty)")
    for m in req.chat:
        lines.append("")
        hdr = f"[{_rel(m.created_at, t0)}] {m.role.upper()}"
        if m.triggered_by:
            hdr += f" (clicked: {m.triggered_by.title})"
        if m.ttft_ms is not None:
            hdr += f" (ttft={m.ttft_ms}ms)"
        lines.append(hdr)
        lines.append(m.content)

    return "\n".join(lines)
