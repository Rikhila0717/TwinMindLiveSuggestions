"""
Parse + clean the JSON blob GPT-OSS returns for a suggestions batch.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .schemas import Suggestion

ALLOWED_TYPES = {
    "answer",
    "fact_check",
    "question",
    "talking_point",
    "clarify",
    "action",
    "risk",
}


def parse_suggestions(raw: str) -> tuple[str | None, list[Suggestion]]:
    obj = _safe_parse_json(raw)
    if not isinstance(obj, dict):
        return None, []

    context_type = obj.get("contextType")
    if not isinstance(context_type, str):
        context_type = None

    cards_raw = obj.get("suggestions")
    if not isinstance(cards_raw, list):
        return context_type, []

    out: list[Suggestion] = []
    for item in cards_raw[:3]:
        if not isinstance(item, dict):
            continue
        t = item.get("type")
        if t not in ALLOWED_TYPES:
            t = "talking_point"
        title = (item.get("title") or "").strip()
        preview = (item.get("preview") or "").strip()
        reasoning = item.get("reasoning")
        if isinstance(reasoning, str):
            reasoning = reasoning.strip() or None
        else:
            reasoning = None
        if not title or not preview:
            continue
        out.append(Suggestion(type=t, title=title, preview=preview, reasoning=reasoning))

    return context_type, out


def _safe_parse_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
