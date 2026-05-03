import type { AppSettings, Suggestion } from "../types";


function withKey(key: string, extra?: HeadersInit): HeadersInit {
  return { "x-groq-key": key, ...(extra ?? {}) };
}

export async function fetchDefaults(): Promise<Partial<AppSettings>> {
  const res = await fetch("/api/defaults");
  if (!res.ok) throw new Error(`Could not load defaults (${res.status})`);
  return res.json();
}

export async function transcribeChunk(
  apiKey: string,
  model: string,
  blob: Blob
): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  form.append("model", model);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: withKey(apiKey),
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || j.detail || `Transcription failed (${res.status})`);
  }
  return res.json();
}

export interface SuggestionsResult {
  contextType?: string;
  suggestions: Suggestion[];
  latencyMs: number;
}

export async function generateSuggestions(
  apiKey: string,
  body: {
    model: string;
    systemPrompt: string;
    transcriptWindow: string;
    priorSuggestions: string;
    temperature: number;
  }
): Promise<SuggestionsResult> {
  const res = await fetch("/api/suggestions", {
    method: "POST",
    headers: withKey(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: body.model,
      system_prompt: body.systemPrompt,
      transcript_window: body.transcriptWindow,
      prior_suggestions: body.priorSuggestions,
      temperature: body.temperature,
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || j.detail || `Suggestions failed (${res.status})`);
  }
  const data = await res.json();
  return {
    contextType: data.context_type ?? undefined,
    suggestions: (data.suggestions || []).map((s: Omit<Suggestion, "id">) => ({
      ...s,
      id: crypto.randomUUID(),
    })),
    latencyMs: data.latency_ms,
  };
}

export interface ChatStreamOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  transcriptWindow: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  suggestionCard?: {
    type: string;
    title: string;
    preview: string;
    reasoning?: string;
  };
  temperature: number;
  maxTokens?: number;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export async function streamChat(opts: ChatStreamOptions): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: withKey(opts.apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: opts.model,
      system_prompt: opts.systemPrompt,
      transcript_window: opts.transcriptWindow,
      history: opts.history,
      user_message: opts.userMessage,
      suggestion_card: opts.suggestionCard ?? null,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens ?? 1200,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || j.detail || `Chat failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) opts.onDelta(chunk);
  }
}

export async function exportSession(
  body: unknown,
  format: "json" | "text"
): Promise<string> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(body as object), format }),
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.text();
}
