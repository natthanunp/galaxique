/**
 * Customizable quiz configuration.
 *
 * `questionCount` is interpolated into the quiz system prompt. The brief allows
 * 5–10; set to 10 for richer per-user signal (single-language output roughly
 * halves per-question token cost vs. the old bilingual 5-question baseline,
 * so 10 single-language questions costs about the same total tokens as the
 * old 5 bilingual ones — see docs/plan/analyze-and-generate-quiz-optimization.md).
 *
 * LLM calls go through OpenRouter exclusively (see lib/llm.ts).
 */
export const quizConfig = {
  /** Number of questions the LLM generates per quiz (5–10 recommended). */
  questionCount: 10,
  /** Thematic lens the questions are written through. */
  theme: "the cosmos, nature, connection, and inner worlds",
  /** Emotional tone of the questions. */
  tone: "honest, varied, and emotionally wide-ranging — from warm and playful to dark, intense, and private",
  /** OpenRouter model id. deepseek/deepseek-v4-flash: ~$0.09/M input,
   *  $0.18/M output, ~0.7-1.1s P50 latency, and a very low structured-output
   *  error rate (~0.2-0.6% on its best provider routes) — cheaper than
   *  google/gemini-3.1-flash-lite ($0.25/$1.50/M) with comparable reliability
   *  for this app's JSON-mode prompts. Set OPENROUTER_MODEL to override, e.g.
   *  back to a free model for $0 cost at higher latency/failure risk. */
  openrouterModel:
    process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
} as const;

/** A pool of style-reference angles shown to the LLM as few-shot examples
 *  when it generates quiz questions (see prompts/quizSystemPrompt.ts). The
 *  model no longer picks from this list directly — it invents its own new
 *  angle per question every call, using a random sample of these as a
 *  grounding example of tone/depth, and the client's recently-seen angles as
 *  a "don't repeat this" list. This removes the old variety ceiling (the
 *  model can invent unlimited distinct angles instead of cycling a fixed
 *  ~24-item pool), while these examples keep every invented angle anchored
 *  to the same "reveal who someone durably is" spirit.
 *
 *  Phrasing matters: each entry is a concrete instruction the LLM must follow
 *  when writing the question — the inline examples anchor abstract topics so
 *  the user instantly knows how to answer. The "spirit" of each angle is
 *  intentionally distinct so that two different rolls almost never produce
 *  overlapping questions.
 *
 *  Keep the list at ~20+ so each call samples a fresh subset of examples. */
export const QUESTION_ANGLES = [
  // Warmth, play, connection, and outward energy (majority tone)
  "Something that instantly lifts the user's mood — a tiny, specific moment of everyday joy",
  "How the user likes to celebrate a small win or good day",
  "A social setting where the user feels most alive — who is there, what is happening",
  "What play or curiosity looks like for the user: a hobby, a question, or a little adventure",
  "How the user shows love or care to people close to them — the small gestures, not the big declarations",
  "A recent small kindness the user gave, received, or witnessed",
  "What warmth feels like to the user — a sound, a room, a person, a ritual",
  "The kind of conversation that makes the user feel most connected",
  "How the user recharges when they need to feel like themselves again",
  "A real or imagined place where the user feels free and open",
  "What the user would spend a free afternoon doing if no one would ever judge them for it",
  "A smell, taste, or texture that instantly takes them back to a good feeling",
  "The kind of weather or time of day the user feels most hopeful in",
  "How the user makes new people feel welcome or at ease",
  "A song, album, or sound the user keeps returning to lately, and what it gives them",
  "What makes the user laugh easily — a person, a style of humor, or a running joke",
  "A small tradition or ritual the user shares with someone they care about",
  "How the user turns an ordinary day into something a little special",
  "A compliment or kind words the user still remembers receiving",
  "What the user gets excited to introduce to a friend",
  "The last thing that made the user feel genuinely lucky",
  "How the user likes to show up for people without being asked",
  // Reflection, depth, and inner life (balanced, not dark)
  "A small daily ritual or habit the user loves and would miss if it disappeared",
  "What makes the user lose track of time — a craft, a sound, a person, a place",
  "How the user handles a tough day — what they reach for, who they call, what they do",
  "A real or imagined place where the user feels most like themselves",
  "What the user daydreams about during quiet moments",
  "A small thing the user feels quietly proud of — something others might not notice",
  "A childhood memory or scene that still feels warm when the user thinks about it",
  "What the user does when they want to feel brave or courageous",
  "A stranger's kindness the user still remembers, however small",
  "What the user is currently learning, curious about, or trying to figure out in life",
  "A piece of media (book, show, film, game) that changed how the user sees something",
  "How the user likes to be comforted when they're down — words, silence, presence, distraction, or something else",
  "The first thing the user notices about someone new — MUST bake 2-3 concrete example anchors into the question wording (e.g. 'What's the first thing you notice about someone new — their energy, how they talk, or something else?')",
  // Dark, intense, private, and inward (use sparingly — minority seasoning)
  "What intensity looks like for the user — a drive, a fixation, or something they feel very strongly",
  "Something the user is quietly driven or ambitious about, even if they don't say it out loud",
  "How the user handles conflict or confrontation — do they meet it, deflect it, or walk away?",
  "A time the user had to be resilient under pressure — what carried them through",
  "An emotion the user feels more deeply than most people seem to",
] as const;

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

/** A soft per-result nudge that prevents companion selection from collapsing
 * onto the same obvious model for every warm or gentle answer set. */
const CREATURE_KIND_HINTS = [
  "fish",
  "bird",
  "fox",
  "cat",
  "dragon",
  "jelly",
  "spirit",
] as const;

export function pickCreatureKindHint(): (typeof CREATURE_KIND_HINTS)[number] {
  return CREATURE_KIND_HINTS[Math.floor(Math.random() * CREATURE_KIND_HINTS.length)];
}

export type QuizConfig = typeof quizConfig;
