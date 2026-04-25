"""
Pydantic request/response schemas for the API.

"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

SuggestionType = Literal[
    "answer",
    "fact_check",
    "question",
    "talking_point",
    "clarify",
    "action",
    "risk",
]


class Suggestion(BaseModel):
    type: SuggestionType = "talking_point"
    title: str
    preview: str
    reasoning: Optional[str] = None


class SuggestionsRequest(BaseModel):
    model: str
    system_prompt: str
    transcript_window: str
    prior_suggestions: str = "(no prior suggestions yet)"
    temperature: float = 0.55


class SuggestionsResponse(BaseModel):
    context_type: Optional[str] = None
    suggestions: list[Suggestion]
    latency_ms: int


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SuggestionCardPayload(BaseModel):
    type: str
    title: str
    preview: str
    reasoning: Optional[str] = None


class ChatRequest(BaseModel):
    model: str
    system_prompt: str
    transcript_window: str
    history: list[ChatTurn] = Field(default_factory=list)
    user_message: str = ""
    suggestion_card: Optional[SuggestionCardPayload] = None
    temperature: float = 0.4
    max_tokens: int = 1200


# ====== Export ======

class TranscriptSegment(BaseModel):
    started_at: int  # ms since epoch
    ended_at: int
    text: str


class ExportedSuggestion(BaseModel):
    type: str
    title: str
    preview: str
    reasoning: Optional[str] = None


class ExportedBatch(BaseModel):
    created_at: int  # ms since epoch
    context_type: Optional[str] = None
    latency_ms: Optional[int] = None
    suggestions: list[ExportedSuggestion]


class ExportedChatMsg(BaseModel):
    created_at: int
    role: Literal["user", "assistant", "system"]
    content: str
    triggered_by: Optional[SuggestionCardPayload] = None
    ttft_ms: Optional[int] = None


class ExportRequest(BaseModel):
    session_started_at: int  # ms since epoch
    transcript: list[TranscriptSegment]
    batches: list[ExportedBatch]
    chat: list[ExportedChatMsg]
    format: Literal["json", "text"] = "json"
