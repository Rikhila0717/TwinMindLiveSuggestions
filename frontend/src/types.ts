export type SuggestionType =
  | "answer"
  | "fact_check"
  | "question"
  | "talking_point"
  | "clarify"
  | "action"
  | "risk";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  preview: string;
  reasoning?: string;
}

export interface SuggestionBatch {
  id: string;
  createdAt: number;
  contextType?: string;
  suggestions: Suggestion[];
  latencyMs?: number;
}

export interface TranscriptSegment {
  id: string;
  startedAt: number;
  endedAt: number;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  sourceSuggestion?: Suggestion;
  ttftMs?: number;
}

export interface AppSettings {
  groqApiKey: string;

  transcriptionModel: string;
  chatModel: string;

  chunkSeconds: number;
  suggestionIntervalSeconds: number;

  suggestionContextSeconds: number;
  /** If speech pauses longer than this, treat the next segment as a new thread for suggestion context. */
  topicGapSeconds: number;
  /**
   * How many seconds at the end of the suggestion window are labeled PRIMARY
   * (the rest is EARLIER). Lower = faster topic switch; higher = more continuity.
   */
  primaryTranscriptSeconds: number;
  detailAnswerContextSeconds: number;
  chatContextSeconds: number;
  suggestionHistoryBatches: number;

  suggestionTemperature: number;
  detailTemperature: number;
  chatTemperature: number;

  liveSuggestionPrompt: string;
  detailAnswerPrompt: string;
  chatPrompt: string;
}

// Defaults come from the Python backend (/api/defaults). This is only the
// initial placeholder value the store uses before that request lands.
export const EMPTY_SETTINGS: AppSettings = {
  groqApiKey: "",
  transcriptionModel: "whisper-large-v3",
  chatModel: "openai/gpt-oss-120b",
  chunkSeconds: 30,
  suggestionIntervalSeconds: 30,
  suggestionContextSeconds: 180,
  topicGapSeconds: 55,
  primaryTranscriptSeconds: 90,
  detailAnswerContextSeconds: 900,
  chatContextSeconds: 1800,
  suggestionHistoryBatches: 2,
  suggestionTemperature: 0.55,
  detailTemperature: 0.35,
  chatTemperature: 0.4,
  liveSuggestionPrompt: "",
  detailAnswerPrompt: "",
  chatPrompt: "",
};
