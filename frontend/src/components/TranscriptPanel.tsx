import { useEffect, useRef } from "react";
import { useTranscript } from "../store";
import { relTime } from "../lib/context";

interface Props {
  sessionStart: number | null;
  isRecording: boolean;
  pendingChunks: number;
}

export default function TranscriptPanel({
  sessionStart,
  isRecording,
  pendingChunks,
}: Props) {
  const segments = useTranscript((s) => s.segments);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length, pendingChunks]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = dist < 80;
  };

  const t0 = sessionStart ?? (segments[0]?.startedAt ?? Date.now());

  return (
    <section className="col-panel">
      <div className="col-header">
        <div>
          <div className="text-sm font-semibold text-ink">Transcript</div>
          <div className="text-xs text-ink-dim">
            {segments.length > 0
              ? `${segments.length} segment${segments.length === 1 ? "" : "s"}`
              : isRecording
                ? "Listening…"
                : "Start listening to begin"}
          </div>
        </div>
        {pendingChunks > 0 && (
          <span className="chip bg-warn/15 text-warn border border-warn/30">
            {pendingChunks} transcribing
          </span>
        )}
      </div>
      <div ref={bodyRef} onScroll={onScroll} className="col-body px-4 py-3 space-y-3 text-sm">
        {segments.length === 0 && !isRecording && (
          <EmptyState />
        )}
        {segments.length === 0 && isRecording && (
          <div className="text-ink-dim text-sm italic">
            First chunk arrives in ~{30}s…
          </div>
        )}
        {segments.map((s) => (
          <div key={s.id} className="flex gap-3">
            <div className="text-xs text-ink-faint font-mono pt-0.5 select-none w-10 flex-none">
              {relTime(s.startedAt, t0)}
            </div>
            <p className="leading-relaxed text-ink/90 whitespace-pre-wrap break-words flex-1">
              {s.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="text-ink-dim text-sm space-y-3 py-6">
      <p className="text-base text-ink font-medium">What this does</p>
      <p>
        Click <span className="text-ink">Start listening</span> and TwinMind captures
        your mic in 30‑second chunks, transcribes them with Whisper, and every time a
        new chunk lands it asks an LLM: <em>"given what was just said, what would
        actually help this person right now?"</em>
      </p>
      <p>
        The middle column is for one‑glance, context‑aware cards — answers to
        direct questions, fact‑checks, smart questions to ask next. Click any card
        to get a full answer in the chat on the right.
      </p>
    </div>
  );
}
