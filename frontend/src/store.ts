import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  type AppSettings,
  type ChatMessage,
  EMPTY_SETTINGS,
  type SuggestionBatch,
  type TranscriptSegment,
} from "./types";

interface TranscriptState {
  segments: TranscriptSegment[];
  append: (seg: TranscriptSegment) => void;
  clear: () => void;
}

export const useTranscript = create<TranscriptState>((set) => ({
  segments: [],
  append: (seg) => set((s) => ({ segments: [...s.segments, seg] })),
  clear: () => set({ segments: [] }),
}));

interface SuggestionsState {
  batches: SuggestionBatch[];
  isLoading: boolean;
  lastError?: string;
  addBatch: (b: SuggestionBatch) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;
  clear: () => void;
}

export const useSuggestions = create<SuggestionsState>((set) => ({
  batches: [],
  isLoading: false,
  addBatch: (b) => set((s) => ({ batches: [b, ...s.batches] })),
  setLoading: (v) => set({ isLoading: v }),
  setError: (e) => set({ lastError: e }),
  clear: () => set({ batches: [], lastError: undefined }),
}));

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  push: (m: ChatMessage) => void;
  updateById: (id: string, patch: Partial<ChatMessage>) => void;
  setStreaming: (v: boolean) => void;
  clear: () => void;
}

export const useChat = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  push: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateById: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  setStreaming: (v) => set({ isStreaming: v }),
  clear: () => set({ messages: [] }),
}));

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;
  setSettings: (patch: Partial<AppSettings>) => void;
  replaceAll: (s: AppSettings) => void;
  setHydrated: (v: boolean) => void;
}

// Settings (including the API key + any user-edited prompts) persist
// to localStorage on this device. Nothing ever leaves the browser except
// on the request path to our backend → Groq.
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: EMPTY_SETTINGS,
      hydrated: false,
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      replaceAll: (next) => set({ settings: next }),
      setHydrated: (v) => set({ hydrated: v }),
    }),
    {
      name: "twinmind.settings.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
    }
  )
);

export function getSettings(): AppSettings {
  return useSettings.getState().settings;
}
