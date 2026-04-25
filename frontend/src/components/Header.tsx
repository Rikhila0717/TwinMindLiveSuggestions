import clsx from "clsx";
import { useEffect, useState } from "react";

interface Props {
  isRecording: boolean;
  sessionStart: number | null;
  onToggleMic: () => void;
  onOpenSettings: () => void;
  onExportJson: () => void;
  onExportText: () => void;
  onClearSession: () => void;
  hasKey: boolean;
}

export default function Header({
  isRecording,
  sessionStart,
  onToggleMic,
  onOpenSettings,
  onExportJson,
  onExportText,
  onClearSession,
  hasKey,
}: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRecording || !sessionStart) return;
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - sessionStart) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRecording, sessionStart]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <header className="sticky top-0 z-20 backdrop-blur bg-bg/80 border-b border-line">
      <div className="max-w-[1600px] mx-auto px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 grid place-items-center text-accent font-bold">
            ⌘
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink leading-tight">TwinMind</div>
            <div className="text-xs text-ink-dim leading-tight">
              Live meeting copilot
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
              isRecording
                ? "bg-danger/10 border-danger/40 text-danger"
                : "bg-bg-raised border-line text-ink-dim"
            )}
          >
            <span
              className={clsx(
                "w-2 h-2 rounded-full",
                isRecording ? "bg-danger animate-pulse-rec" : "bg-ink-faint"
              )}
            />
            {isRecording ? `LIVE · ${mm}:${ss}` : "Idle"}
          </div>

          <button
            onClick={onToggleMic}
            className={clsx(
              isRecording ? "btn-danger" : "btn-primary",
              !hasKey && "opacity-60"
            )}
            title={hasKey ? undefined : "Add your Groq API key in Settings"}
          >
            {isRecording ? (
              <>
                <MicOffIcon />
                Stop
              </>
            ) : (
              <>
                <MicIcon />
                Start listening
              </>
            )}
          </button>

          <MenuButton
            label="Export"
            icon={<DownloadIcon />}
            items={[
              { label: "Download JSON", onClick: onExportJson },
              { label: "Download transcript (.txt)", onClick: onExportText },
            ]}
          />

          <button
            onClick={onClearSession}
            className="btn-outline"
            title="Clear transcript, suggestions, and chat"
          >
            <TrashIcon />
            Clear
          </button>

          <button onClick={onOpenSettings} className="btn-outline" title="Settings">
            <GearIcon />
            Settings
          </button>
        </div>
      </div>
    </header>
  );
}

function MenuButton({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button className="btn-outline" onClick={() => setOpen((v) => !v)}>
        {icon}
        {label}
        <ChevronIcon />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 min-w-[220px] bg-bg-raised border border-line rounded-lg shadow-xl py-1 animate-slide-down z-50">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-white/5"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 11-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
    </svg>
  );
}
function MicOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4l16 16-1.4 1.4-3-3a7 7 0 01-2.6.52V21h-2v-3.08a7 7 0 01-6-6.92h2a5 5 0 004.53 4.97L2.6 5.4 4 4zm8-2a3 3 0 013 3v4.2l-6-6A3 3 0 0112 2zm7 9h-2c0 .44-.06.87-.17 1.28l-1.48-1.48c.1-.26.15-.52.15-.8h3.5z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94a7.14 7.14 0 000-1.88l2.03-1.58a.5.5 0 00.12-.63l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54A.5.5 0 0013.9 2h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.58.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.66 8.48a.5.5 0 00.12.63L4.81 10.7a7.14 7.14 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.63l1.92 3.32a.5.5 0 00.6.22l2.39-.96c.5.39 1.05.7 1.63.94l.36 2.54a.5.5 0 00.5.42h3.84a.5.5 0 00.5-.42l.36-2.54c.58-.24 1.13-.55 1.63-.94l2.39.96a.5.5 0 00.6-.22l1.92-3.32a.5.5 0 00-.12-.63l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3v10.59l3.29-3.3 1.42 1.42L12 16.41l-4.71-4.7 1.42-1.42 3.29 3.3V3h2zM5 19h14v2H5z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 7h12v2H6V7zm2 3h8l-1 10H9L8 10zm3-6h2a2 2 0 012 2v1h-6V6a2 2 0 012-2z" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}
