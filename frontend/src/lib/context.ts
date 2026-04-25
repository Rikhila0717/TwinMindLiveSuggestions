import type { SuggestionBatch, TranscriptSegment } from "../types";

/**
 * "Live topic" is usually in the last 1–1.5 min, while the suggestion window
 * may be 3+ minutes. Without a split, the model can mix cards for an old thread
 * with a new one because both are still in the string.
 */
export const DEFAULT_PRIMARY_TRANSCRIPT_SECONDS = 90;

/**
 * If the gap between the end of one segment and the start of the next exceeds
 * this, we treat the later segment as a new "topic" for suggestion context
 * (automatic boundary).
 */
export const DEFAULT_TOPIC_GAP_SECONDS = 55;

function formatSegment(s: TranscriptSegment, sessionStart: number): string {
  const rel = Math.max(0, Math.floor((s.startedAt - sessionStart) / 1000));
  const mm = String(Math.floor(rel / 60)).padStart(2, "0");
  const ss = String(rel % 60).padStart(2, "0");
  return `[${mm}:${ss}] ${s.text.trim()}`;
}

/**
 * After a long pause in speech, the next segment is treated as a new context
 * thread for live suggestions. Returns 'null' if no inter-segment gap was
 * large enough (or segments empty / feature disabled), so the caller can fall
 * back to a pure time window.
 */
export function findTopicGapAnchorMs(
  segments: TranscriptSegment[],
  gapMs: number,
  _nowMs: number
): number | null {
  if (segments.length === 0 || gapMs <= 0) return null;
  const sorted = [...segments].sort((a, b) => a.startedAt - b.startedAt);
  const firstStart = sorted[0].startedAt;
  let anchor = firstStart;
  let found = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].startedAt - sorted[i].endedAt;
    if (gap >= gapMs) {
      anchor = sorted[i + 1].startedAt;
      found = true;
    }
  }
  if (!found) return null;
  return anchor;
}

export type BuildTranscriptWindowOptions = {
  /** Wall clock for recency; defaults to `Date.now()` (injectable for tests). */
  nowMs?: number;
  /**
   * Optional floor time (e.g. for tests) — drop segments that ended before this.
   * The app no longer sets this from the UI; automatic topic gap uses
   * `findTopicGapAnchorMs` via `topicGapSeconds` instead.
   */
  hardAnchorMs?: number | null;
  /**
   * Feature toggle / threshold (seconds). 0 = disable automatic gap-based anchor.
   */
  topicGapSeconds?: number;
  /**
   * Last N seconds of the effective window are labeled PRIMARY. Capped by the
   * effective window length so short post-anchor windows stay one block.
   */
  primarySeconds?: number;
};

/**
 * Build the transcript string we ship to the LLM. We keep only the most
 * recent `windowSeconds` of conversation — after optional anchors so a new
 * script or a long pause does not keep pulling the previous monologue in.
 *
 * When the window has both very recent and older material, we label a
 * PRIMARY (last ~primarySeconds) section vs EARLIER so the model anchors
 * one thread.
 */
export function buildTranscriptWindow(
  segments: TranscriptSegment[],
  windowSeconds: number,
  sessionStart: number,
  options: BuildTranscriptWindowOptions = {}
): string {
  if (segments.length === 0) return "(no transcript yet)";
  const now = options.nowMs ?? Date.now();
  const windowMs = windowSeconds * 1000;
  const gapSec = options.topicGapSeconds ?? DEFAULT_TOPIC_GAP_SECONDS;
  const gapMs = gapSec > 0 ? gapSec * 1000 : 0;
  const gapAnchor = gapMs > 0 ? findTopicGapAnchorMs(segments, gapMs, now) : null;
  const hard = options.hardAnchorMs != null && options.hardAnchorMs > 0 ? options.hardAnchorMs : null;
  const floorMs = Math.max(gapAnchor ?? 0, hard ?? 0);
  const timeWindowStart = now - windowMs;
  const windowStart = Math.max(timeWindowStart, floorMs);
  const effectiveWindowSec = Math.max(0, (now - windowStart) / 1000);
  const primaryCap = options.primarySeconds ?? DEFAULT_PRIMARY_TRANSCRIPT_SECONDS;
  const focusSec = Math.min(primaryCap, windowSeconds, effectiveWindowSec);
  const focusStart = now - focusSec * 1000;

  const inWindow = segments.filter((s) => s.endedAt >= windowStart);
  if (inWindow.length === 0) return "(no transcript yet)";

  const inPrimary = inWindow.filter((s) => s.endedAt >= focusStart);
  const inBackground = inWindow.filter((s) => s.endedAt < focusStart);
  if (inBackground.length === 0) {
    return inPrimary.map((s) => formatSegment(s, sessionStart)).join("\n");
  }
  if (inPrimary.length === 0) {
    return inWindow.map((s) => formatSegment(s, sessionStart)).join("\n");
  }

  const primaryBlock = inPrimary
    .map((s) => formatSegment(s, sessionStart))
    .join("\n");
  const earlierBlock = inBackground
    .map((s) => formatSegment(s, sessionStart))
    .join("\n");
  return [
    "=== PRIMARY (the live thread; all 3 suggestions must be about THIS; if it clearly differs from EARLIER, treat EARLIER as absent for topic choice and do not mix subjects across cards) ===",
    primaryBlock,
    "",
    "=== EARLIER in this window (continuity/entities only; do NOT use for new cards or examples when the subject differs from PRIMARY) ===",
    earlierBlock,
  ].join("\n");
}

export function buildPriorSuggestionsBlock(
  batches: SuggestionBatch[],
  n: number
): string {
  if (!batches.length || n <= 0) return "(no prior suggestions yet)";
  return batches
    .slice(0, n)
    .map((b, i) => {
      const lines = b.suggestions
        .map((s) => `  - [${s.type}] ${s.title} — ${s.preview}`)
        .join("\n");
      return `Batch ${i + 1} (newest first):\n${lines}`;
    })
    .join("\n\n");
}

export function relTime(t: number, t0: number): string {
  const sec = Math.max(0, Math.floor((t - t0) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
