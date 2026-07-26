/**
 * Customizable quiz configuration.
 *
 * `questionCount` is interpolated into the quiz system prompt. The brief allows
 * 5–10; we default to 5 to balance engagement against fatigue. Adjust freely.
 *
 * LLM calls go through OpenRouter exclusively (see lib/llm.ts).
 */
export const quizConfig = {
  /** Number of questions the LLM generates per quiz (5–10 recommended). */
  questionCount: 5,
  /** Thematic lens the questions are written through. */
  theme: "the cosmos, nature, and inner worlds",
  /** Emotional tone of the questions. */
  tone: "dreamy, warm, slightly whimsical",
  /** OpenRouter model id. deepseek/deepseek-v4-flash: ~$0.09/M input,
   *  $0.18/M output, ~0.7-1.1s P50 latency, and a very low structured-output
   *  error rate (~0.2-0.6% on its best provider routes) — cheaper than
   *  google/gemini-3.1-flash-lite ($0.25/$1.50/M) with comparable reliability
   *  for this app's JSON-mode prompts. Set OPENROUTER_MODEL to override, e.g.
   *  back to a free model for $0 cost at higher latency/failure risk. */
  openrouterModel:
    process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
} as const;

/** The full pool of question angles. Exactly one slot per quiz is reserved
 *  for the soulmate angle (added separately, never sampled from this list).
 *  The remaining `questionCount - 1` slots are drawn from this pool.
 *
 *  Phrasing matters: each entry is a concrete instruction the LLM must follow
 *  when writing the question — the inline examples anchor abstract topics so
 *  the user instantly knows how to answer. The "spirit" of each angle is
 *  intentionally distinct so that two different rolls almost never produce
 *  overlapping questions.
 *
 *  Keep the list at ~20+ to give the sampler enough room to vary; with 5
 *  questions, 20+ angles means the same combination of 4 is unlikely to
 *  repeat even across many sessions. */
export const QUESTION_ANGLES = [
  "How the user recharges or spends a slow, unscheduled day",
  "The first thing the user notices about someone new — MUST bake 2-3 concrete example anchors into the question wording (e.g. 'What's the first thing you notice about someone new — their energy, how they talk, or something else?')",
  "A small fear or quiet worry that visits the user sometimes",
  "What 'home' or 'safety' feels like to the user — concrete, sensory (a sound, a smell, a room)",
  "A small daily ritual or habit the user loves and would miss if it disappeared",
  "What makes the user lose track of time — a craft, a sound, a person, a place",
  "How the user handles a tough day — what they reach for, who they call, what they do",
  "Something that instantly lifts the user's mood — a tiny, specific moment",
  "A real or imagined place where the user feels most like themselves",
  "How the user shows love or care to people close to them — the small gestures, not the big declarations",
  "What the user daydreams about during quiet moments",
  "A small thing the user feels quietly proud of — something others might not notice",
  "A song, album, or sound the user keeps returning to lately, and what it gives them",
  "What the user wishes more people understood about them",
  "A childhood memory or scene that still feels warm when the user thinks about it",
  "The kind of weather or time of day the user feels most themselves in",
  "What the user does when they want to feel brave or courageous",
  "A stranger's kindness the user still remembers, however small",
  "What the user would spend a free afternoon doing if no one would ever judge them for it",
  "A smell, taste, or texture that instantly takes the user back to a feeling",
  "The kind of conversation that makes the user feel most seen",
  "What the user is currently learning, curious about, or trying to figure out in life",
  "A piece of media (book, show, film, game) that changed how the user sees something",
  "How the user likes to be comforted when they're down — words, silence, presence, distraction, or something else",
] as const;

/** The reserved soulmate/love-themed angle. Always appears exactly once per
 *  quiz, and is intentionally NOT in the main pool so it can't be sampled
 *  twice. Wording guidance keeps the question warm and respectful, not
 *  invasive — the goal is to surface how the user loves, not to interrogate
 *  their relationship status. */
export const SOULMATE_ANGLE =
  "The user's ideal soulmate or the kind of person they want to be with — what qualities, what presence, what feeling. Warm and respectful, not invasive. Keep it about what they'd love to feel beside someone, not about who they currently are or aren't with." as const;

/** Song era/origin pools used to mechanically force variety in the
 *  `spotify_search_query` the reveal LLM picks (see prompts/revealSystemPrompt.ts).
 *  Without this, the model reliably gravitates toward the single most famous
 *  song for a given vibe every time (same failure mode the quiz question
 *  angles used to have — see QUESTION_ANGLES above). A random era + origin
 *  pair is picked per `/api/analyze` call and injected as a soft constraint,
 *  so repeated calls with a similar vibe don't collapse onto the same track. */
export const SONG_ERA_POOL = [
  "a 1970s-80s classic",
  "a 1990s classic",
  "a 2000s hit",
  "a 2010s hit",
  "a current (2020s) hit",
] as const;

export const SONG_ORIGIN_POOL = [
  "English-language",
  "Thai",
  "broadly-known international (K-pop, J-pop, Latin, etc.)",
] as const;

/** Picks one random era + origin pair to inject into the reveal prompt. */
export function pickSongFlavorHint(): string {
  const era = SONG_ERA_POOL[Math.floor(Math.random() * SONG_ERA_POOL.length)];
  const origin =
    SONG_ORIGIN_POOL[Math.floor(Math.random() * SONG_ORIGIN_POOL.length)];
  return `${era}, ${origin}`;
}

export type QuizConfig = typeof quizConfig;
