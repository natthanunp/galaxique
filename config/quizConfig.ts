/**
 * Customizable quiz configuration.
 *
 * LLM calls go through OpenRouter exclusively (see lib/llm.ts).
 */
export const quizConfig = {
  /** Number of questions generated per quiz. Eight gives the profile enough
   *  independent signals while keeping the Thai Qwen3.8 payload within the
   *  route's latency budget. */
  questionCount: 8,
  /** Generic OpenRouter model for English quizzes, assessment, and reveals. */
  openrouterModel:
    process.env.OPENROUTER_MODEL || "openai/gpt-oss-20b",
} as const;
