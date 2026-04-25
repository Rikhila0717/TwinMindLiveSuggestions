import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import Header from "./components/Header";
import SettingsModal from "./components/SettingsModal";
import SuggestionsPanel from "./components/SuggestionsPanel";
import TranscriptPanel from "./components/TranscriptPanel";
import {
  fetchDefaults,
  generateSuggestions,
  streamChat,
  transcribeChunk,
} from "./lib/api";
import { ChunkedRecorder } from "./lib/audio";
import {
  buildPriorSuggestionsBlock,
  buildTranscriptWindow,
  type BuildTranscriptWindowOptions,
} from "./lib/context";
import { downloadSessionExport } from "./lib/export";
import {
  getSettings,
  useChat,
  useSettings,
  useSuggestions,
  useTranscript,
} from "./store";
import type { AppSettings, Suggestion, SuggestionBatch } from "./types";

function transcriptWindowOptionsForLLM(): BuildTranscriptWindowOptions {
  const s = getSettings();
  return {
    topicGapSeconds: s.topicGapSeconds ?? 55,
    primarySeconds: s.primaryTranscriptSeconds ?? 90,
  };
}

export default function App() {
  const { settings, setSettings, hydrated, setHydrated } = useSettings();
  const transcriptSegs = useTranscript((s) => s.segments);
  const appendSegment = useTranscript((s) => s.append);
  const clearTranscript = useTranscript((s) => s.clear);
  const suggestionBatches = useSuggestions((s) => s.batches);
  const addBatch = useSuggestions((s) => s.addBatch);
  const setSuggLoading = useSuggestions((s) => s.setLoading);
  const setSuggError = useSuggestions((s) => s.setError);
  const clearSuggestions = useSuggestions((s) => s.clear);
  const chatMessages = useChat((s) => s.messages);
  const pushChat = useChat((s) => s.push);
  const updateChatById = useChat((s) => s.updateById);
  const setStreaming = useChat((s) => s.setStreaming);
  const clearChat = useChat((s) => s.clear);
  const isStreaming = useChat((s) => s.isStreaming);

  const [isRecording, setIsRecording] = useState(false);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaults, setDefaults] = useState<Partial<AppSettings> | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [nextRefreshIn, setNextRefreshIn] = useState(30);

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const lastSuggestionAt = useRef(0);
  const suggInFlight = useRef(false);
  const streamAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  // Pull the crafted default prompts (and other config) from the
  // FastAPI backend and seed the store only if the user hasn't
  // overridden them yet. This keeps the prompt strategy in one
  // canonical place (backend/prompts.py).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchDefaults();
        if (cancelled) return;
        setDefaults(d);
        const cur = useSettings.getState().settings;
        const patch: Partial<AppSettings> = {};
        if (!cur.liveSuggestionPrompt && d.liveSuggestionPrompt)
          patch.liveSuggestionPrompt = d.liveSuggestionPrompt;
        if (!cur.detailAnswerPrompt && d.detailAnswerPrompt)
          patch.detailAnswerPrompt = d.detailAnswerPrompt;
        if (!cur.chatPrompt && d.chatPrompt) patch.chatPrompt = d.chatPrompt;
        if (cur.topicGapSeconds == null && d.topicGapSeconds != null) {
          patch.topicGapSeconds = d.topicGapSeconds;
        }
        if (cur.primaryTranscriptSeconds == null && d.primaryTranscriptSeconds != null) {
          patch.primaryTranscriptSeconds = d.primaryTranscriptSeconds;
        }
        if (Object.keys(patch).length) setSettings(patch);
      } catch (e) {
        console.warn("Failed to fetch defaults:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  // Pop the settings modal on first run so the user is prompted for a key.
  useEffect(() => {
    if (!hydrated) return;
    if (!settings.groqApiKey) setSettingsOpen(true);
  }, [hydrated, settings.groqApiKey]);

  const hasKey = settings.groqApiKey.trim().length > 0;

  const onChunk = useCallback(
    async (
      blob: Blob,
      startedAt: number,
      endedAt: number,
      level: { rms: number }
    ) => {
      const { groqApiKey, transcriptionModel } = getSettings();
      if (!groqApiKey) return;
      // Send everything to Whisper. We previously had a client-side RMS gate
      // (skip if 0.001 ≤ rms < 0.02), but on deployed HTTPS the browser
      // throttles our AnalyserNode hard enough that real speech reads at
      // 0.006 — the gate then silently dropped 30 s of real audio. The
      // recorder itself (different audio subsystem) captured the speech
      // correctly; only our measurement was unreliable. Trust the
      // recorder. The backend already short-circuits chunks < 1 KB, and
      // Whisper's own VAD handles the rare hallucinated "thanks" line on
      // genuine silence.
      void level;
      setPendingChunks((n) => n + 1);
      try {
        const { text } = await transcribeChunk(groqApiKey, transcriptionModel, blob);
        const clean = (text || "").trim();
        if (clean) {
          appendSegment({
            id: crypto.randomUUID(),
            startedAt,
            endedAt,
            text: clean,
          });
        }
      } catch (e) {
        console.error("Transcription error:", e);
        setSuggError((e as Error).message);
      } finally {
        setPendingChunks((n) => Math.max(0, n - 1));
      }
    },
    [appendSegment, setSuggError]
  );

  const toggleMic = useCallback(async () => {
    if (!hasKey) {
      setSettingsOpen(true);
      return;
    }
    if (isRecording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      setIsRecording(false);
      return;
    }
    try {
      const rec = new ChunkedRecorder({
        chunkSeconds: getSettings().chunkSeconds,
        onChunk,
        onError: (e) => setSuggError(e.message),
      });
      await rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
      if (!sessionStart) setSessionStart(Date.now());
      lastSuggestionAt.current = 0;
    } catch (e) {
      const msg = (e as Error).message || "Could not access microphone";
      if (msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")) {
        setSuggError("Microphone permission denied. Enable it in your browser settings.");
      } else {
        setSuggError(msg);
      }
    }
  }, [hasKey, isRecording, onChunk, sessionStart, setSuggError]);

  const runSuggestions = useCallback(async () => {
    if (suggInFlight.current) return;
    const s = getSettings();
    if (!s.groqApiKey) return;
    const segs = useTranscript.getState().segments;
    if (segs.length === 0) return;
    const t0 = sessionStart ?? segs[0].startedAt;

    const transcriptWindow = buildTranscriptWindow(
      segs,
      s.suggestionContextSeconds,
      t0,
      transcriptWindowOptionsForLLM()
    );
    const prior = buildPriorSuggestionsBlock(
      useSuggestions.getState().batches,
      s.suggestionHistoryBatches
    );

    suggInFlight.current = true;
    setSuggLoading(true);
    setSuggError(undefined);
    const t = performance.now();
    try {
      const res = await generateSuggestions(s.groqApiKey, {
        model: s.chatModel,
        systemPrompt: s.liveSuggestionPrompt,
        transcriptWindow,
        priorSuggestions: prior,
        temperature: s.suggestionTemperature,
      });
      if (res.suggestions.length === 0) return;
      const batch: SuggestionBatch = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        contextType: res.contextType,
        suggestions: res.suggestions,
        latencyMs: res.latencyMs ?? Math.round(performance.now() - t),
      };
      addBatch(batch);
      lastSuggestionAt.current = Date.now();
    } catch (e) {
      setSuggError((e as Error).message);
    } finally {
      setSuggLoading(false);
      suggInFlight.current = false;
    }
  }, [addBatch, sessionStart, setSuggError, setSuggLoading]);

  // Ticker: fires every second while recording. It:
  // (1) updates the visible "next refresh in Ns" countdown, and
  // (2) triggers a new suggestion call once the cadence has elapsed
  //     AND the latest transcript segment landed after the last batch
  //     (otherwise we'd just re-ask about identical context).
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      const s = getSettings();
      const interval = s.suggestionIntervalSeconds * 1000;
      const since = Date.now() - (lastSuggestionAt.current || 0);
      setNextRefreshIn(Math.max(0, Math.ceil((interval - since) / 1000)));
      if (since < interval) return;
      const segs = useTranscript.getState().segments;
      if (segs.length === 0) return;
      const newest = segs[segs.length - 1].endedAt;
      if (newest <= (lastSuggestionAt.current || 0)) return;
      runSuggestions();
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording, runSuggestions]);

  const manualRefresh = useCallback(() => {
    recorderRef.current?.flushAndRestart();
    runSuggestions();
  }, [runSuggestions]);

  // Ask flow — used both by suggestion card clicks and the chat input.
  const ask = useCallback(
    async (userMessage: string, source?: Suggestion) => {
      const s = getSettings();
      if (!s.groqApiKey) {
        setSettingsOpen(true);
        return;
      }
      const segs = useTranscript.getState().segments;
      const t0 = sessionStart ?? segs[0]?.startedAt ?? Date.now();
      const windowSec = source ? s.detailAnswerContextSeconds : s.chatContextSeconds;
      const transcriptWindow = buildTranscriptWindow(
        segs,
        windowSec,
        t0,
        transcriptWindowOptionsForLLM()
      );

      const userId = crypto.randomUUID();
      pushChat({
        id: userId,
        role: "user",
        content: source ? `[${source.type}] ${source.title}` : userMessage,
        createdAt: Date.now(),
        sourceSuggestion: source,
      });
      const asstId = crypto.randomUUID();
      pushChat({
        id: asstId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        sourceSuggestion: source,
      });

      const history = useChat
        .getState()
        .messages.slice(0, -2)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-8)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const systemPrompt = source ? s.detailAnswerPrompt : s.chatPrompt;
      const temperature = source ? s.detailTemperature : s.chatTemperature;

      const controller = new AbortController();
      streamAbort.current = controller;
      setStreaming(true);
      const t = performance.now();
      let firstToken = -1;
      let got = "";

      try {
        await streamChat({
          apiKey: s.groqApiKey,
          model: s.chatModel,
          systemPrompt,
          transcriptWindow,
          history,
          userMessage,
          suggestionCard: source
            ? {
                type: source.type,
                title: source.title,
                preview: source.preview,
                reasoning: source.reasoning,
              }
            : undefined,
          temperature,
          onDelta: (d) => {
            if (firstToken < 0) firstToken = Math.round(performance.now() - t);
            got += d;
            updateChatById(asstId, { content: got, ttftMs: firstToken });
          },
          signal: controller.signal,
        });
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") {
          updateChatById(asstId, {
            content: got + `\n\n_error: ${err.message}_`,
          });
        }
      } finally {
        setStreaming(false);
        streamAbort.current = null;
      }
    },
    [pushChat, sessionStart, setStreaming, updateChatById]
  );

  const stopStream = useCallback(() => {
    streamAbort.current?.abort();
  }, []);

  const clearSession = useCallback(() => {
    if (isRecording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      setIsRecording(false);
    }
    clearTranscript();
    clearSuggestions();
    clearChat();
    setSessionStart(null);
    lastSuggestionAt.current = 0;
  }, [clearChat, clearSuggestions, clearTranscript, isRecording]);

  const doExport = useCallback(
    (fmt: "json" | "text") => {
      downloadSessionExport(
        {
          sessionStartedAt: sessionStart ?? Date.now(),
          transcript: transcriptSegs,
          batches: suggestionBatches,
          chat: chatMessages,
        },
        fmt
      );
    },
    [chatMessages, sessionStart, suggestionBatches, transcriptSegs]
  );

  const canRefresh = useMemo(
    () => isRecording && transcriptSegs.length > 0,
    [isRecording, transcriptSegs.length]
  );

  return (
    <div className="min-h-full flex flex-col">
      <Header
        isRecording={isRecording}
        sessionStart={sessionStart}
        onToggleMic={toggleMic}
        onOpenSettings={() => setSettingsOpen(true)}
        onExportJson={() => doExport("json")}
        onExportText={() => doExport("text")}
        onClearSession={clearSession}
        hasKey={hasKey}
      />

      <main className="flex-1 min-h-0 max-w-[1600px] w-full mx-auto p-4">
        <div className="grid gap-4 h-[calc(100vh-88px)] grid-cols-1 lg:grid-cols-[1.1fr_1fr_1.2fr]">
          <TranscriptPanel
            sessionStart={sessionStart}
            isRecording={isRecording}
            pendingChunks={pendingChunks}
          />
          <SuggestionsPanel
            isRecording={isRecording}
            onCardClick={(s) => ask(`Expand on: ${s.title}`, s)}
            onRefresh={manualRefresh}
            canRefresh={canRefresh}
            secondsToNextRefresh={nextRefreshIn}
          />
          <ChatPanel
            onSend={(t) => ask(t)}
            onStop={stopStream}
            disabled={!hasKey || isStreaming}
            keyMissing={!hasKey}
          />
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        defaults={defaults}
      />
    </div>
  );
}
