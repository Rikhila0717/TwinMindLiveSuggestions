import type { ChatMessage, SuggestionBatch, TranscriptSegment } from "../types";
import { exportSession } from "./api";

export interface ExportPayload {
  sessionStartedAt: number;
  transcript: TranscriptSegment[];
  batches: SuggestionBatch[];
  chat: ChatMessage[];
}

export async function downloadSessionExport(
  payload: ExportPayload,
  format: "json" | "text"
): Promise<void> {
  const body = {
    session_started_at: payload.sessionStartedAt,
    transcript: payload.transcript.map((s) => ({
      started_at: s.startedAt,
      ended_at: s.endedAt,
      text: s.text,
    })),
    batches: payload.batches.map((b) => ({
      created_at: b.createdAt,
      context_type: b.contextType,
      latency_ms: b.latencyMs,
      suggestions: b.suggestions.map((s) => ({
        type: s.type,
        title: s.title,
        preview: s.preview,
        reasoning: s.reasoning,
      })),
    })),
    chat: payload.chat.map((m) => ({
      created_at: m.createdAt,
      role: m.role,
      content: m.content,
      triggered_by: m.sourceSuggestion
        ? {
            type: m.sourceSuggestion.type,
            title: m.sourceSuggestion.title,
            preview: m.sourceSuggestion.preview,
            reasoning: m.sourceSuggestion.reasoning,
          }
        : null,
      ttft_ms: m.ttftMs ?? null,
    })),
  };

  const text = await exportSession(body, format);
  const blob = new Blob([text], {
    type: format === "json" ? "application/json" : "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `twinmind-session-${stamp()}.${format === "json" ? "json" : "txt"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
