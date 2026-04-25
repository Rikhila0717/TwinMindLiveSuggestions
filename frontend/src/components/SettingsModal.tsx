import { useEffect, useState } from "react";
import { useSettings } from "../store";
import type { AppSettings } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  defaults: Partial<AppSettings> | null;
}

export default function SettingsModal({ open, onClose, defaults }: Props) {
  const { settings, setSettings } = useSettings();
  const [local, setLocal] = useState<AppSettings>(settings);

  useEffect(() => {
    if (open) {
      setLocal({
        ...settings,
        topicGapSeconds: settings.topicGapSeconds ?? 55,
        primaryTranscriptSeconds: settings.primaryTranscriptSeconds ?? 90,
      });
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => {
    setSettings(local);
    onClose();
  };

  const resetPrompt = (key: "liveSuggestionPrompt" | "detailAnswerPrompt" | "chatPrompt") => {
    const v = defaults?.[key];
    if (typeof v === "string") setLocal((s) => ({ ...s, [key]: v }));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg-raised border border-line rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-line flex items-center justify-between flex-none">
          <div>
            <h2 className="text-lg font-semibold text-ink">Settings</h2>
            <p className="text-xs text-ink-dim mt-0.5">
              Your API key and prompt overrides stay in this browser only.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <Section title="Groq API key" subtitle="Paste your key from console.groq.com. Stored in localStorage, sent only to our server as a proxy header to Groq.">
            <input
              type="password"
              autoComplete="off"
              className="input font-mono text-xs"
              placeholder="gsk_…"
              value={local.groqApiKey}
              onChange={(e) => setLocal({ ...local, groqApiKey: e.target.value })}
            />
          </Section>

          <Section title="Models">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Transcription model">
                <input
                  className="input"
                  value={local.transcriptionModel}
                  onChange={(e) => setLocal({ ...local, transcriptionModel: e.target.value })}
                />
              </Field>
              <Field label="Chat / suggestions model">
                <input
                  className="input"
                  value={local.chatModel}
                  onChange={(e) => setLocal({ ...local, chatModel: e.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section title="Chunking & cadence">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Chunk length (s) — ${local.chunkSeconds}`}>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={5}
                  value={local.chunkSeconds}
                  onChange={(e) => setLocal({ ...local, chunkSeconds: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Suggestion cadence (s) — ${local.suggestionIntervalSeconds}`}>
                <input
                  type="range"
                  min={15}
                  max={120}
                  step={5}
                  value={local.suggestionIntervalSeconds}
                  onChange={(e) => setLocal({ ...local, suggestionIntervalSeconds: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Context windows"
            subtitle="How much past transcript each prompt sees. Shorter = faster and more focused; longer = more memory. Suggestion lookback is also trimmed after a long pause in speech (topic gap) so old monologues drop out for live cards."
          >
            <div className="grid grid-cols-3 gap-3">
              <Field label={`Live suggestions (s) — ${local.suggestionContextSeconds}`}>
                <input
                  type="range"
                  min={60}
                  max={600}
                  step={30}
                  value={local.suggestionContextSeconds}
                  onChange={(e) => setLocal({ ...local, suggestionContextSeconds: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Detail answer (s) — ${local.detailAnswerContextSeconds}`}>
                <input
                  type="range"
                  min={120}
                  max={1800}
                  step={60}
                  value={local.detailAnswerContextSeconds}
                  onChange={(e) => setLocal({ ...local, detailAnswerContextSeconds: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label={`Chat (s) — ${local.chatContextSeconds}`}>
                <input
                  type="range"
                  min={120}
                  max={3600}
                  step={60}
                  value={local.chatContextSeconds}
                  onChange={(e) => setLocal({ ...local, chatContextSeconds: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={`Topic gap (s) — ${local.topicGapSeconds ?? 55}`}
                sublabel="A pause in speech longer than this starts a new context thread for live suggestions. Set 0 to disable. Lower catches quick subject switches; higher keeps one thread across long pauses."
              >
                <input
                  type="range"
                  min={0}
                  max={180}
                  step={5}
                  value={local.topicGapSeconds ?? 55}
                  onChange={(e) =>
                    setLocal({ ...local, topicGapSeconds: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </Field>
              <Field
                label={`PRIMARY block (s) — ${local.primaryTranscriptSeconds ?? 90}`}
                sublabel="How much of the end of the suggestion window is labeled PRIMARY vs EARLIER. Tuning it affects how fast the model is nudged toward the most recent lines."
              >
                <input
                  type="range"
                  min={45}
                  max={180}
                  step={5}
                  value={local.primaryTranscriptSeconds ?? 90}
                  onChange={(e) =>
                    setLocal({ ...local, primaryTranscriptSeconds: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </Field>
            </div>
            <Field label={`Anti-repeat history (batches) — ${local.suggestionHistoryBatches}`}>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={local.suggestionHistoryBatches}
                onChange={(e) => setLocal({ ...local, suggestionHistoryBatches: Number(e.target.value) })}
                className="w-full"
              />
            </Field>
          </Section>

          <Section title="Sampling temperatures">
            <div className="grid grid-cols-3 gap-3">
              <TempField
                label="Suggestions"
                value={local.suggestionTemperature}
                onChange={(v) => setLocal({ ...local, suggestionTemperature: v })}
              />
              <TempField
                label="Detail answer"
                value={local.detailTemperature}
                onChange={(v) => setLocal({ ...local, detailTemperature: v })}
              />
              <TempField
                label="Chat"
                value={local.chatTemperature}
                onChange={(v) => setLocal({ ...local, chatTemperature: v })}
              />
            </div>
          </Section>

          <Section title="Prompts (editable)" subtitle="These ship the full prompt strategy to the model. Reset to restore the default crafted prompt.">
            <PromptField
              label="Live suggestions system prompt"
              value={local.liveSuggestionPrompt}
              onChange={(v) => setLocal({ ...local, liveSuggestionPrompt: v })}
              onReset={() => resetPrompt("liveSuggestionPrompt")}
              rows={10}
            />
            <PromptField
              label="Detail answer system prompt"
              value={local.detailAnswerPrompt}
              onChange={(v) => setLocal({ ...local, detailAnswerPrompt: v })}
              onReset={() => resetPrompt("detailAnswerPrompt")}
              rows={8}
            />
            <PromptField
              label="Freeform chat system prompt"
              value={local.chatPrompt}
              onChange={(v) => setLocal({ ...local, chatPrompt: v })}
              onReset={() => resetPrompt("chatPrompt")}
              rows={8}
            />
          </Section>
        </div>

        <div className="p-5 border-t border-line flex justify-end gap-2 flex-none">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={save} className="btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-dim mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-ink-dim">{label}</span>
      {sublabel && <span className="text-[10px] text-ink-faint block leading-relaxed">{sublabel}</span>}
      {children}
    </label>
  );
}

function TempField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={`${label} — ${value.toFixed(2)}`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </Field>
  );
}

function PromptField({
  label,
  value,
  onChange,
  onReset,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  rows: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-dim">{label}</span>
        <button onClick={onReset} className="text-[11px] text-accent hover:underline">
          Reset to default
        </button>
      </div>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="textarea"
      />
    </div>
  );
}
