import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../lib/md";
import { useChat } from "../store";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
  keyMissing?: boolean;
}

export default function ChatPanel({ onSend, onStop, disabled, keyMissing }: Props) {
  const { messages, isStreaming } = useChat();
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  const handleSend = () => {
    const t = draft.trim();
    if (!t || disabled) return;
    onSend(t);
    setDraft("");
  };

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = dist < 80;
  };

  return (
    <section className="col-panel">
      <div className="col-header">
        <div>
          <div className="text-sm font-semibold text-ink flex items-center gap-2">
            Ask / deep dive
            {isStreaming && <span className="text-xs text-accent font-normal">streaming…</span>}
          </div>
          <div className="text-xs text-ink-dim">
            Grounded in your live transcript
          </div>
        </div>
      </div>

      <div
        ref={bodyRef}
        onScroll={onScroll}
        className="col-body px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <EmptyChat disabled={disabled} keyMissing={keyMissing} />
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} source={m.sourceSuggestion} ttftMs={m.ttftMs} />
        ))}
      </div>

      <div className="flex-none border-t border-line p-3 bg-bg-panel/60">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder={
              keyMissing
                ? "Add your Groq API key in Settings to enable chat…"
                : 'Ask anything — "summarize the last 5 minutes"…'
            }
            className="input resize-none font-sans text-xs flex-1 min-h-[40px] max-h-[140px]"
            disabled={disabled}
          />
          {isStreaming ? (
            <button onClick={onStop} className="btn-danger">
              Stop
            </button>
          ) : (
            <button onClick={handleSend} className="btn-primary" disabled={disabled || !draft.trim()}>
              Send
            </button>
          )}
        </div>
        <div className="text-[11px] text-ink-faint mt-1.5 px-0.5">
          Enter = send · Shift+Enter = newline
        </div>
      </div>
    </section>
  );
}

function ChatBubble({
  role,
  content,
  source,
  ttftMs,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  source?: { type: string; title: string };
  ttftMs?: number;
}) {
  const isUser = role === "user";
  return (
    <div className={clsx("flex animate-fade-in", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[92%] rounded-xl px-3.5 py-2.5 border text-sm",
          isUser
            ? "bg-accent/15 border-accent/30 text-ink"
            : "bg-bg-raised border-line text-ink"
        )}
      >
        {source && !isUser && (
          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1.5">
            answering: {source.title}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        ) : (
          <div
            className="md"
            dangerouslySetInnerHTML={{
              __html:
                renderMarkdown(content) +
                (content.length === 0 ? '<span class="caret"></span>' : ""),
            }}
          />
        )}
        {typeof ttftMs === "number" && !isUser && (
          <div className="text-[10px] text-ink-faint mt-1.5 font-mono">
            first token: {ttftMs}ms
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyChat({ disabled, keyMissing }: { disabled?: boolean; keyMissing?: boolean }) {
  return (
    <div className="text-ink-dim text-sm space-y-2 py-2">
      <p className="text-ink font-medium">How to use this column</p>
      <ul className="list-disc ml-5 space-y-1 text-ink-dim">
        <li>Click any suggestion card to get a detailed, transcript‑grounded answer.</li>
        <li>
          Or type freeform questions like{" "}
          <em>"what decisions have we made so far?"</em> or{" "}
          <em>"draft a follow‑up email"</em>.
        </li>
        <li>Answers stream in real time and reference the live transcript.</li>
      </ul>
      {(disabled || keyMissing) && (
        <p className="text-warn text-xs pt-1">
          {keyMissing
            ? "Paste your Groq API key in Settings to enable chat."
            : "Start listening to enable chat over live audio."}
        </p>
      )}
    </div>
  );
}
