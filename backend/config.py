"""
Default app settings. These are the values the frontend seeds its Settings
modal with on first load. Everything here is user-editable at runtime.
"""

import os
from dataclasses import asdict, dataclass

from . import prompts

GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")


@dataclass
class AppDefaults:
    # Models
    transcription_model: str = "whisper-large-v3"
    chat_model: str = "openai/gpt-oss-120b"

    # Audio chunking
    chunk_seconds: int = 30
    suggestion_interval_seconds: int = 30

    # Context windows (seconds of most recent transcript passed to each call).
    # Live suggestions look at the last N sec (client default 3 min); the client
    # also tags the end of the window as "PRIMARY" vs "EARLIER" and can trim
    # after a long speech gap (see topic_gap_seconds).
    # Detail answers get a much wider window (user is asking for depth).
    # Chat gets the widest — users often ask "what did they say earlier about X".
    suggestion_context_seconds: int = 180
    # If gap between STT segment end and next segment start exceeds this, the
    # client starts the suggestion window after the gap (automatic topic
    # boundary for live cards).
    topic_gap_seconds: int = 55
    # Size of the PRIMARY (vs EARLIER) band at the end of the suggestion window.
    primary_transcript_seconds: int = 90
    detail_answer_context_seconds: int = 900
    chat_context_seconds: int = 1800
    suggestion_history_batches: int = 2

    # Generation parameters — slightly warm for suggestions so we get
    # variety across the 3 cards and across batches.
    suggestion_temperature: float = 0.55
    detail_temperature: float = 0.35
    chat_temperature: float = 0.4

    # Prompts.
    live_suggestion_prompt: str = prompts.LIVE_SUGGESTION_PROMPT
    detail_answer_prompt: str = prompts.DETAIL_ANSWER_PROMPT
    chat_prompt: str = prompts.CHAT_PROMPT


def defaults_dict() -> dict:
    return asdict(AppDefaults())
