"""
Drop likely Whisper STT garbage using fields from 'response_format=verbose_json'.


OpenAI-Compatible segment fields (when present):
  - no_speech_prob: higher = more likely non-speech (0–1)
  - avg_logprob: higher = more confident/consistent transcript (less negative is better)
  - compression_ratio: very high often indicates repeated/garbage output


"""

from __future__ import annotations

import re

# Drop segment if no_speech_prob is at or above this (0–1)
_NO_SPEECH_CUTOFF = 0.5

# If avg_logprob is present and below this, the segment is often hallucination
# Good speech is typically much higher (e.g. -0.2 … -0.7); garbage often < -1.0
_AVG_LOGPROB_MIN = -0.95

# If compression_ratio is present and above this, drop (repetition / garbage signature)
_COMPRESSION_RATIO_MAX = 2.5

# Short lines on near-silence: extra weight on no_speech
_SHORT_WORDS_MAX = 4
_NO_SPEECH_STRICTER_FOR_SHORT = 0.4

def should_keep_whisper_segment(seg: dict) -> bool:
    """
    Return True if this segment’s text should be kept in the transcript.
    'seg' is one element of the verbose_json 'segments' list.
    """
    if not isinstance(seg, dict):
        return False
    t = (seg.get("text") or "").strip()
    if not t:
        return False

    try:
        p = float(seg.get("no_speech_prob", 0.0) or 0.0)
    except (TypeError, ValueError):
        p = 0.0

    if p >= _NO_SPEECH_CUTOFF:
        return False

    al = _optional_float(seg.get("avg_logprob"))
    dur = _segment_duration_s(seg)

    # "Thank you" / "Thanks" alone is a very common Whisper false positive on
    # silence. Without listing every possible filler, we use: (a) the segment is
    # only a short courtesy line, and (b) time is very short, or p / logprob
    # look like noise.
    if _courtesy_thanks_only(t) and len(t.split()) <= 3:
        if al is not None and al < -0.5:
            return False
        # Very short in wall-clock time: common for silence glitches; a normal
        # sign-off is usually a bit longer.
        if dur is not None and dur < 0.45 and p >= 0.12:
            return False
        if dur is not None and dur < 0.8 and p >= 0.28:
            return False
        if dur is None and p >= 0.4:
            return False

    # Single-word backchannels on silence (e.g. "Okay.") often sit in a
    # mid-range no_speech band without hitting 0.5; drop on borderline p
    if len(t.split()) == 1 and p >= 0.42:
        return False

    # Strong signal when the API provides it: model is internally unsure / babbling
    if al is not None and al < _AVG_LOGPROB_MIN:
        return False

    cr = _optional_float(seg.get("compression_ratio"))
    if cr is not None and cr > _COMPRESSION_RATIO_MAX:
        return False

    n_words = len(t.split())
    if n_words <= _SHORT_WORDS_MAX and p >= _NO_SPEECH_STRICTER_FOR_SHORT:
        return False

    return True


def _optional_float(x: object) -> float | None:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _segment_duration_s(seg: dict) -> float | None:
    """Unmerged segments usually have 'start' and 'end' in seconds."""
    try:
        a = float(seg.get("start", 0))
        b = float(seg.get("end", 0))
    except (TypeError, ValueError):
        return None
    d = b - a
    return d if d > 0 else None


def _courtesy_thanks_only(t: str) -> bool:
    s = re.sub(r"[\s!?.:]+$", "", t.lower().strip())
    s = re.sub(r"^[\s!?.:]+", "", s)
    s = re.sub(r"\s+", " ", s)
    return s in (
        "thank you",
        "thanks",
        "thank you so much",
    )
