import clsx from "clsx";
import { useSuggestions } from "../store";
import type { Suggestion, SuggestionType } from "../types";

interface Props {
  isRecording: boolean;
  onCardClick: (s: Suggestion) => void;
  onRefresh: () => void;
  canRefresh: boolean;
  secondsToNextRefresh: number;
}

const TYPE_META: Record<SuggestionType, { label: string; className: string }> = {
  answer:        { label: "ANSWER",      className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  fact_check:    { label: "FACT-CHECK",  className: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  question:      { label: "ASK",         className: "bg-sky-500/15 text-sky-300 border border-sky-500/30" },
  talking_point: { label: "SAY",         className: "bg-violet-500/15 text-violet-300 border border-violet-500/30" },
  clarify:       { label: "CLARIFY",     className: "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30" },
  action:        { label: "DO",          className: "bg-rose-500/15 text-rose-300 border border-rose-500/30" },
  risk:          { label: "RISK",        className: "bg-orange-500/15 text-orange-200 border border-orange-500/35" },
};

export default function SuggestionsPanel({
  isRecording,
  onCardClick,
  onRefresh,
  canRefresh,
  secondsToNextRefresh,
}: Props) {
  const { batches, isLoading, lastError } = useSuggestions();
  const latestBatch = batches[0];

  return (
    <section className="col-panel">
      <div className="col-header">
        <div>
          <div className="text-sm font-semibold text-ink flex items-center gap-2">
            Live suggestions
            {isLoading && <span className="text-xs text-accent font-normal">thinking…</span>}
          </div>
          <div className="text-xs text-ink-dim">
            {latestBatch
              ? `${latestBatch.suggestions.length} · ${latestBatch.contextType ?? "meeting"} · updates every ~30s`
              : "No suggestions yet"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-outline text-xs"
            onClick={onRefresh}
            disabled={!canRefresh || isLoading}
            title={canRefresh ? "Force a new suggestion now" : "Start listening first"}
          >
            <RefreshIcon />
            {isLoading ? "Working…" : `Refresh${isRecording ? ` · ${secondsToNextRefresh}s` : ""}`}
          </button>
        </div>
      </div>

      <div className="col-body px-4 py-3 space-y-3">
        <details className="text-xs text-ink-dim border border-line/70 rounded-lg px-3 py-2 bg-bg/40 group open:border-line">
          <summary className="cursor-pointer list-none font-medium text-ink-dim/90 select-none flex items-center gap-1.5 marker:content-[''] [&::-webkit-details-marker]:hidden">
            <span className="text-ink-faint group-open:rotate-90 transition-transform inline-block">›</span>
            How are these suggestions chosen?
          </summary>
          <div className="mt-2.5 pl-0 border-l-2 border-accent/25 pl-2.5 space-y-2 leading-relaxed text-ink-faint">
            <p>
              On each refresh, the model looks at the <strong className="text-ink-dim/90">latest stretch</strong> of
              what was said. You get up to <strong className="text-ink-dim/90">three</strong> cards.               The colored
              tag on each card (ASK, ANSWER, SAY, RISK, …) is the <em>kind of move</em> that card is offering—not the
              topic of the meeting.
            </p>
            <p>
              <strong className="text-ink-dim/90">When more than one kind of help could make sense at once</strong>
              {", "}
              (for example, an unanswered question in the same breath as a claim you might want to verify), the
              three cards are still built to stay aligned with what is most in focus in the <strong className="text-ink-dim/90">last
              minute or two</strong>, so they read as a coherent &quot;what to do next&quot;—not three unrelated
              ideas. That is a simple priority on the assistant side, not a conflict between you and anyone else
              in the room.
            </p>
          </div>
        </details>

        {!latestBatch && !isLoading && (
          <div className="text-ink-dim text-sm py-2">
            Suggestions appear once the first audio chunk (~30s) has been transcribed.
            Each card is a single, non-repeating cue worth acting on.
          </div>
        )}

        {lastError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {lastError}
          </div>
        )}

        {latestBatch && (
          <div className="space-y-2">
            <BatchLabel
              label="Now"
              contextType={latestBatch.contextType}
              latencyMs={latestBatch.latencyMs}
            />
            <div className="grid gap-2">
              {latestBatch.suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} onClick={() => onCardClick(s)} />
              ))}
            </div>
          </div>
        )}

        {batches.slice(1, 4).map((b) => (
          <div key={b.id} className="space-y-2 opacity-75">
            <BatchLabel
              label="Earlier"
              contextType={b.contextType}
              createdAt={b.createdAt}
            />
            <div className="grid gap-2">
              {b.suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} onClick={() => onCardClick(s)} compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({
  s,
  onClick,
  compact = false,
}: {
  s: Suggestion;
  onClick: () => void;
  compact?: boolean;
}) {
  const meta = TYPE_META[s.type] ?? TYPE_META.talking_point;
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left bg-bg-raised border border-line rounded-lg hover:border-accent/50 hover:bg-bg-raised/70 hover:shadow-glow transition-all group animate-fade-in",
        compact ? "p-2.5" : "p-3"
      )}
    >
      <div className="flex items-start gap-2">
        <span className={clsx("chip flex-none mt-0.5", meta.className)}>{meta.label}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink leading-snug">
            {s.title}
          </div>
          <div className="text-xs text-ink-dim mt-1 leading-relaxed line-clamp-3">
            {s.preview}
          </div>
          {s.reasoning && !compact && (
            <div className="text-[11px] text-ink-faint italic mt-1.5">
              why: {s.reasoning}
            </div>
          )}
          <div className="text-[11px] text-accent mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            Click for full answer →
          </div>
        </div>
      </div>
    </button>
  );
}

function BatchLabel({
  label,
  contextType,
  createdAt,
  latencyMs,
}: {
  label: string;
  contextType?: string;
  createdAt?: number;
  latencyMs?: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-faint">
      <span>{label}</span>
      {contextType && <span>· {contextType}</span>}
      {typeof latencyMs === "number" && <span>· {Math.round(latencyMs)}ms</span>}
      {createdAt && <span>· {new Date(createdAt).toLocaleTimeString()}</span>}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.65 6.35A8 8 0 006.34 7.76L4.93 6.34A10 10 0 0121 11h-3a7.93 7.93 0 00-.35-4.65zM6.35 17.65A8 8 0 0017.66 16.24l1.41 1.42A10 10 0 013 13h3a7.93 7.93 0 00.35 4.65zM12 8v5l3.5 2.1-.75 1.25L10.5 14V8H12z" />
    </svg>
  );
}
