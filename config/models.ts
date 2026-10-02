/**
 * Single checked-in source for every LLM route. English and Thai use the same
 * model and provider rules; language only changes prompts and validation.
 */

export type ReasoningEffort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export type ModelTask = "quiz" | "assessment" | "reveal" | "chat";

export interface ModelRoute {
  model: string;
  /** Lowercase OpenRouter provider slugs, tried in order. Model-specific. */
  providers: readonly string[];
  allowFallbacks: boolean;
  providerSort: "latency" | "throughput";
  /** Zero-data-retention routing. Off: the enabled endpoints 404 under ZDR. */
  zdr: boolean;
}

export interface TaskSettings {
  reasoningEffort?: ReasoningEffort;
  /** Per-call cap in ms. */
  timeoutMs: number;
}

const configuredProviders = process.env.OPENROUTER_PROVIDER_ORDER
  ?.split(",")
  .map(provider => provider.trim())
  .filter(Boolean);

export const SHARED_MODEL: ModelRoute = {
  model: process.env.OPENROUTER_MODEL || "openai/gpt-6-luna",
  providers: configuredProviders?.length ? configuredProviders : ["openai", "azure"],
  allowFallbacks: true,
  providerSort: "throughput",
  zdr: false,
};

export const TASKS: Record<ModelTask, TaskSettings> = {
  // Reasoning off: the quiz needs fast structured copy and is validated server-side.
  quiz: { reasoningEffort: "none", timeoutMs: 12_000 },
  assessment: { reasoningEffort: "low", timeoutMs: 20_000 },
  reveal: { reasoningEffort: "low", timeoutMs: 20_000 },
  chat: { reasoningEffort: "low", timeoutMs: 15_000 },
};

export const QUIZ_LIMITS = {
  questionCount: 8,
  overallMs: 30_000,
  initialCallMs: 12_000,
  repairCallMs: 8_000,
} as const;
