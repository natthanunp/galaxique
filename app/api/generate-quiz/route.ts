import { NextResponse } from "next/server";

import { callLlm, resolveProviderOrder } from "@/lib/llm";
import {
  quizPayloadSchema,
  quizPlanSchema,
  quizQuestionDraftSchema,
} from "@/lib/schemas";
import {
  buildQuizSystemPrompt,
  buildQuizPlannerPrompt,
  buildQuizWriterPrompt,
  type QuizPlanItem,
} from "@/prompts/quizSystemPrompt";
import { quizConfig, QUESTION_ANGLES } from "@/config/quizConfig";
import { wantsEventStream } from "@/lib/analyzeProgress";
import {
  quizSseStream,
  type QuizProgressCallback,
} from "@/lib/quizProgress";
import type { QuizQuestion } from "@/types/universe";

export const runtime = "nodejs";
// Quiz generation is dynamic per call; don't cache at the framework level.
export const dynamic = "force-dynamic";

/** How many entries from the static QUESTION_ANGLES pool to show the LLM as
 *  style/depth reference examples per call. The model invents its own real
 *  angles — these are just grounding examples, not a fixed menu — so this
 *  can be smaller than questionCount without capping variety. */
const EXAMPLE_ANGLE_COUNT = 5;
const MAX_AVOID_ANGLES_IN_PROMPT = 12;
const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const THAI_LETTER = /\p{Script=Thai}/u;
// Thai quiz defaults to qwen3-32b. Live OpenRouter stats (re-verified
// Aug 2026) show that for this model the ONLY viable provider under the
// 30s attempt budget is Groq at 321 tok/s p50 / 286ms p50 latency / 100%
// uptime — every other route is either dead (Alibaba 0% uptime) or too
// slow (DeepInfra 25 tok/s = ~60s for 1500 output tokens, SiliconFlow
// 19 tok/s, Nebius 24 tok/s). 1500 Thai tokens on Groq complete in
// ~5s of generation + ~300ms latency, well inside the 30s budget.
// Cost: ~$0.0009/quiz at the published rates — negligible. Override
// with OPENROUTER_THAI_QUIZ_MODEL to fall back to the previous model
// if quality regresses.
const THAI_QUIZ_MODEL =
  process.env.OPENROUTER_THAI_QUIZ_MODEL || "qwen/qwen3-32b";
// Optional secondary model used ONLY if the first attempt times out. Picking
// a DIFFERENT model (not just rotating providers on the same model) is the
// actual timeout fix: when the primary route is congested, retrying the
// same model on another provider usually re-hits the same backend. Default
// is the previous Thai model so behavior degrades gracefully.
const THAI_QUIZ_FALLBACK_MODEL =
  process.env.OPENROUTER_THAI_QUIZ_FALLBACK_MODEL
  || "deepseek/deepseek-v4-flash-0731";
// Live OpenRouter stats (re-verified Aug 2026): for `qwen/qwen3-32b` the
// only provider that finishes 1500 tokens inside the 30s attempt budget
// is Groq (321 tok/s p50 / 100% uptime). DeepInfra (25 tok/s) and
// SiliconFlow (19 tok/s) are too slow to serve as primary; Alibaba is
// at 0% uptime. BaseTen doesn't serve this model. The primary list is
// just Groq — there is no faster fallback at this model. Override via
// OPENROUTER_THAI_QUIZ_PROVIDER_ORDER to experiment.
const THAI_QUIZ_PROVIDER_ORDER = (
  process.env.OPENROUTER_THAI_QUIZ_PROVIDER_ORDER
  || "groq"
)
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
// Live OpenRouter endpoint stats for `deepseek/deepseek-v4-flash-0731`
// (re-verified Aug 2026): BaseTen is the fastest reliable route at
// 402ms p50 / 76 tok/s / 99.9% uptime — beats first-party DeepSeek
// (1106ms / 64 tok/s) and Cloudflare (720ms / 42 tok/s). Baidu is also
// strong (682ms p50 / 95 tok/s / 100% uptime / cheapest at $0.088/M)
// and was previously assumed dead at 0% uptime — it isn't anymore.
// Order: Baidu (fastest + cheapest) → BaseTen → Parasail (81 tok/s,
// 758ms p50) → Cloudflare → SiliconFlow (100% uptime, 64 tok/s) →
// DeepSeek official → DeepInfra (cheap but 33 tok/s) → Novita.
// DeepInfra stays in the list as a budget fallback since it's
// $0.09/M (cheapest per-token) — only used when the fast routes all
// fail. The prior "baseten first" order pre-dated Baidu's recovery
// and left the fast route on the bench. Override via
// OPENROUTER_THAI_QUIZ_FALLBACK_PROVIDER_ORDER.
const THAI_QUIZ_FALLBACK_PROVIDER_ORDER = (
  process.env.OPENROUTER_THAI_QUIZ_FALLBACK_PROVIDER_ORDER
  || "baidu,baseten,parasail,cloudflare,siliconflow,deepseek,deepinfra,novita"
)
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);

/** JSON-object mode only asks the provider for syntactically-valid JSON, and
 * some routes have returned a body cut off mid-question. Strict schema mode
 * makes OpenRouter constrain the complete nested payload before returning it. */
const QUIZ_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  jsonSchema: {
    name: "personality_quiz",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: quizConfig.questionCount,
          maxItems: quizConfig.questionCount,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "angle", "text", "options"],
            properties: {
              id: { type: "integer", minimum: 1 },
              angle: { type: "string", minLength: 1 },
              text: { type: "string", minLength: 1 },
              options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text"],
                  properties: { text: { type: "string", minLength: 1 } },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Strict-schema output for the PLANNER call: 8 {angle, dimension, temperature}
 *  entries in English (~200 tokens). Small enough to complete on any provider,
 *  fast. */
const QUIZ_PLAN_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  jsonSchema: {
    name: "quiz_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: quizConfig.questionCount,
          maxItems: quizConfig.questionCount,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["angle", "dimension", "temperature", "opening", "thought"],
            properties: {
              angle: { type: "string", minLength: 1 },
              dimension: { type: "string", minLength: 1 },
              temperature: { type: "string", minLength: 1 },
              opening: { type: "string", minLength: 1 },
              thought: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
  },
};

/** Strict-schema output for a single WRITER call: one question + 4 options. */
const QUIZ_WRITER_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  jsonSchema: {
    name: "quiz_question",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["text", "options"],
      properties: {
        text: { type: "string", minLength: 1 },
        options: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text"],
            properties: { text: { type: "string", minLength: 1 } },
          },
        },
      },
    },
  },
};

/** How many question-writer calls run concurrently. Capped so a single slow
 *  provider isn't hit with 8 simultaneous requests (rate-limit / queueing
 *  storms). 4 concurrent writers is still a ~4x wall-clock win over serial. */
const WRITER_CONCURRENCY = Number(
  process.env.QUIZ_WRITER_CONCURRENCY || "4",
);

/** Run `fn` over `items` with at most `limit` promises in flight at once,
 *  preserving input order in the result. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Requests come from a browser bundle whose local storage can outlive several
 * releases. The shape and intent of these optional fields has stayed the
 * same across releases, so unknown fields can be discarded without turning
 * a recoverable stale-client state into a 400 — except for `language`,
 * which is now load-bearing: the quiz contract is single-language. A bad
 * or missing value is surfaced as a 400 because silently falling back to
 * English would override the user's selected UI language on a stale bundle.
 */
function parseRequestBody(raw: unknown): {
  ok: true;
  avoidAngles: string[];
  language: "en" | "th";
  nonce: string | undefined;
} | { ok: false; error: string } {
  const body = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  if (body.language !== "en" && body.language !== "th") {
    return {
      ok: false,
      error: '`language` is required and must be "en" or "th".',
    };
  }
  return {
    ok: true,
    avoidAngles: Array.isArray(body.avoidAngles)
      ? body.avoidAngles.filter((angle): angle is string => typeof angle === "string").slice(-50)
      : [],
    language: body.language,
    nonce: typeof body.nonce === "string" && body.nonce.length <= 100
      ? body.nonce
      : undefined,
  };
}

/**
 * JSON mode guarantees structure, not that an LLM obeys a natural-language
 * script instruction. Reject text with a high rate of letters from a
 * foreign writing system — e.g. mostly-Cyrillic output when Thai was asked
 * for — but tolerate the occasional stray Latin character that
 * small open-source models (qwen3-32b on Groq in particular) often drop
 * into otherwise-correct Thai output. The previous 100%-strict check
 * discarded a lot of usable responses and triggered a full regeneration
 * cycle, which is the bulk of the "Thai quiz takes 20s+" tail latency.
 *
 * Threshold rationale: at 90%, a single stray Latin char in a 10-char
 * question still passes; ~3 stray chars in 30 chars passes; a question
 * that's actually 50%+ foreign script (a true model-drift failure) fails.
 * This eliminates the most common Thai-quiz retry while still catching
 * genuine script flips. The existing retry loop remains the safety net
 * for the rare >10% case.
 */
const SCRIPT_MATCH_THRESHOLD = 0.9;

function usesExpectedScript(text: string, language: "en" | "th"): boolean {
  let letters = 0;
  let matching = 0;
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    letters++;
    const isExpected = language === "th"
      ? THAI_LETTER.test(character)
      : LATIN_LETTER.test(character);
    if (isExpected) matching++;
  }
  // Empty / non-letter text (e.g. an option that's just a digit or
  // punctuation) trivially passes — there's nothing to check.
  if (letters === 0) return true;
  return matching / letters >= SCRIPT_MATCH_THRESHOLD;
}

function hasExpectedScript(
  questions: { text: string; options: { text: string }[] }[],
  language: "en" | "th",
): boolean {
  return questions.every(
    (question) =>
      usesExpectedScript(question.text, language) &&
      question.options.every((option) => usesExpectedScript(option.text, language)),
  );
}

/** Lightweight post-correction map for frequent Thai spelling/verb-form
 *  glitches from small fast models (e.g. qwen3-32b on Groq). Applied AFTER
 *  schema validation so we only rewrite text, never structure. Add entries
 *  here as new recurring errors are spotted in production. */
const THAI_TEXT_CORRECTIONS: { pattern: RegExp; replacement: string }[] = [
  // "แช่ม" is a common hallucinated form of "แช่" in self-care options.
  { pattern: /แช่ม/g, replacement: "แช่" },
];

function correctThaiText(text: string): string {
  return THAI_TEXT_CORRECTIONS.reduce(
    (out, { pattern, replacement }) => out.replace(pattern, replacement),
    text,
  );
}

/** Coerce common LLM output quirks into the schema's expected shape in
 *  place. Cheap to do once per call; saves a 25s retry on otherwise-good
 *  output from models that drop object wrappers under JSON-schema pressure. */
function normalizeLlmQuizShape(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object") return;
  const root = parsed as { questions?: unknown };
  if (!Array.isArray(root.questions)) return;
  for (let qi = 0; qi < root.questions.length; qi++) {
    const question = root.questions[qi] as Record<string, unknown> | string | null;
    if (question === null || typeof question !== "object") {
      root.questions[qi] = { text: String(question ?? "") };
      continue;
    }
    if (typeof question.id !== "number") {
      question.id = qi + 1;
    }
    if (typeof question.options !== "object" || !Array.isArray(question.options)) {
      question.options = [];
      continue;
    }
    for (let oi = 0; oi < question.options.length; oi++) {
      const option = question.options[oi];
      if (typeof option === "string" || option === null) {
        question.options[oi] = { text: String(option ?? "") };
        continue;
      }
      if (typeof option === "object" && option !== null) {
        const obj = option as Record<string, unknown>;
        if (typeof obj.text !== "string") {
          if (typeof obj.text_en === "string") obj.text = obj.text_en;
          else if (typeof obj.text_th === "string") obj.text = obj.text_th;
        }
      }
    }
    if (typeof question.text !== "string") {
      const fallback = (question as Record<string, unknown>).text_en
        ?? (question as Record<string, unknown>).text_th;
      if (typeof fallback === "string") question.text = fallback;
    }
  }
}

/** Pick `count` distinct random entries from `pool`, preferring entries that
 * aren't in `avoid`. Used to sample a fresh set of style-reference angles
 * each call so the few-shot examples themselves stay varied.
 *
 *  Fisher–Yates is fine here — `pool` is tiny (~24) and called once per
 *  request, so we don't need cryptographic randomness. */
function pickAngles(
  pool: readonly string[],
  count: number,
  avoid: ReadonlySet<string>,
): string[] {
  const fresh = pool.filter((a) => !avoid.has(a));
  // If the caller has avoided too many (e.g. after several retries), fall
  // back to the full pool so we never under-fill.
  const source = fresh.length >= count ? fresh : pool;
  const arr = [...source];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error
    && (err.name === "TimeoutError" || /aborted due to timeout/i.test(err.message));
}

type SplitResult =
  | { ok: true; questions: QuizQuestion[]; pickedAngles: string[] }
  | { ok: false; timeout: boolean };

/** Model + provider routing for one language's split pipeline. Thai uses the
 *  dedicated qwen3-32b/Groq route (with a genuinely-different fallback model);
 *  English uses the default model and rotates its provider order on retry. */
function splitRouting(language: "en" | "th") {
  if (language === "th") {
    return {
      primaryModel: THAI_QUIZ_MODEL,
      fallbackModel: THAI_QUIZ_FALLBACK_MODEL,
      primaryProviders: THAI_QUIZ_PROVIDER_ORDER,
      fallbackProviders: THAI_QUIZ_FALLBACK_PROVIDER_ORDER,
      temperature: 0.7,
    };
  }
  const providers = resolveProviderOrder();
  return {
    primaryModel: quizConfig.openrouterModel,
    fallbackModel: quizConfig.openrouterModel,
    primaryProviders: providers,
    fallbackProviders: [...providers.slice(1), providers[0]],
    temperature: 0.9,
  };
}

/** Write one planned question on the primary model, retrying once on the
 *  fallback model if the first attempt fails or fails validation. Returns the
 *  validated draft or null (so a single failed question can be re-reconciled
 *  rather than failing the whole batch). */
async function writeOneQuestion(
  planItem: QuizPlanItem,
  index: number,
  nonce: string,
  language: "en" | "th",
  preferredProviderSort: "latency" | "throughput",
  fallbackProviderSort: "latency" | "throughput",
): Promise<{ draft: NonNullable<ReturnType<typeof quizQuestionDraftSchema.safeParse>["data"]> } | null> {
  const routing = splitRouting(language);
  const systemPrompt = buildQuizWriterPrompt(planItem, language);
  const userPrompt = `Write question ${index + 1} now for nonce=${nonce}:${index}.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const isFallback = attempt === 1;
    const model = isFallback ? routing.fallbackModel : routing.primaryModel;
    const providerOrder = isFallback
      ? routing.fallbackProviders
      : routing.primaryProviders;
    try {
      const parsed = await callLlm({
        systemPrompt,
        userPrompt,
        model,
        providerOrder,
        responseFormat: QUIZ_WRITER_RESPONSE_FORMAT,
        temperature: routing.temperature,
        // One question + 4 options ≈ 90-120 tokens; 350 is a wide margin.
        maxTokens: 350,
        timeoutMs: isFallback ? 30_000 : 22_000,
        nonce: `${nonce}:q${index}:${attempt}`,
        purpose: "generate-quiz-writer",
        providerSort: attempt === 0 ? preferredProviderSort : fallbackProviderSort,
      });
      const candidate = quizQuestionDraftSchema.safeParse(parsed);
      if (candidate.success) return { draft: candidate.data };
    } catch (err) {
      console.warn(
        `[generate-quiz] writer q${index + 1} attempt ${attempt + 1} failed`,
        err,
      );
    }
  }
  return null;
}

/** The validated shape of one writer's output. */
type QuestionDraft = NonNullable<ReturnType<typeof quizQuestionDraftSchema.safeParse>["data"]>;

/** Normalize a question's opening for collision detection: lowercase, strip
 *  punctuation, collapse whitespace, and take the first ~24 characters. Two
 *  questions that both open "หลังเลิกงานเหนื่อยๆ" (or "หลังงานเสร็จ…") collide;
 *  genuinely different scenes don't. */
function openingFingerprint(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

/** Collision prefixes we explicitly don't want repeated across the batch
 *  (the model's strongest priors). Kept language-neutral here because the
 *  fingerprint already captures the script. */
const BLOCKED_OPENINGS = ["หลังเลิกงาน", "หลังงานเสร็จ", "after work"];

function isBlockedOpening(fingerprint: string): boolean {
  return BLOCKED_OPENINGS.some((blocked) => fingerprint.includes(blocked));
}

/** After all 8 writers land, detect questions whose openings collide (or hit a
 *  blocked prior) and re-roll the LATER duplicates once. Keeps the first
 *  occurrence, re-rolls the rest with a hard "your scene is X, never use the
 *  collided opening" nudge. Deterministic — this is the safety net that makes
 *  the prompt-level scene anchor reliable, not a replacement for it. */
async function dedupeQuestionOpenings(
  drafts: QuestionDraft[],
  planItems: QuizPlanItem[],
  nonce: string,
  language: "en" | "th",
  preferredProviderSort: "latency" | "throughput",
  fallbackProviderSort: "latency" | "throughput",
): Promise<QuestionDraft[]> {
  const result = [...drafts];
  const seen = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    const fp = openingFingerprint(result[i].text);
    const existing = seen.get(fp);
    if (existing !== undefined || isBlockedOpening(fp)) {
      const reroll = await writeOneQuestionWithSceneNudge(
        planItems[i],
        i,
        nonce,
        language,
        preferredProviderSort,
        fallbackProviderSort,
        existing !== undefined
          ? openingFingerprint(result[existing].text)
          : fp,
      );
      if (reroll) result[i] = reroll;
    }
    const newFp = openingFingerprint(result[i].text);
    if (!seen.has(newFp)) seen.set(newFp, i);
  }
  return result;
}

/** Re-write one question with an explicit "never use this collided opening"
 *  nudge appended to the user prompt. Same model/provider routing as the
 *  normal writer; a single attempt (no inner retry) so a stubborn model can't
 *  stall the whole batch — if this fails, we keep the collided original. */
async function writeOneQuestionWithSceneNudge(
  planItem: QuizPlanItem,
  index: number,
  nonce: string,
  language: "en" | "th",
  preferredProviderSort: "latency" | "throughput",
  fallbackProviderSort: "latency" | "throughput",
  collidedOpening: string,
): Promise<QuestionDraft | null> {
  const routing = splitRouting(language);
  const systemPrompt = buildQuizWriterPrompt(planItem, language);
  const userPrompt = `Write question ${index + 1} now for nonce=${nonce}:${index}.
REMINDER: your assigned scene is "${planItem.thought}". Another question already opened with "${collidedOpening}" — you must NOT open with it or any near-paraphrase. Start from your own assigned scene.`;
  try {
    const parsed = await callLlm({
      systemPrompt,
      userPrompt,
      model: routing.primaryModel,
      providerOrder: routing.primaryProviders,
      responseFormat: QUIZ_WRITER_RESPONSE_FORMAT,
      temperature: routing.temperature,
      maxTokens: 350,
      timeoutMs: 22_000,
      nonce: `${nonce}:q${index}:reroll`,
      purpose: "generate-quiz-writer",
      providerSort: preferredProviderSort,
    });
    const candidate = quizQuestionDraftSchema.safeParse(parsed);
    if (candidate.success) return candidate.data;
  } catch (err) {
    console.warn(`[generate-quiz] writer q${index + 1} re-roll failed`, err);
  }
  return null;
}

/** Split fast path: planner (1 small call) → 8 parallel single-question
 *  writers → merge. Quality is preserved (each writer gets the FULL language
 *  writing rules, focused on one question), and wall-clock time collapses
 *  because no call produces more than ~200 tokens. If any question still
 *  can't be written after retries, we return ok:false and the caller falls
 *  back to the proven single-call path so the batch NEVER drops below
 *  ${quizConfig.questionCount} questions. */
async function generateQuizSplit(opts: {
  exampleAngles: string[];
  recentAvoidAngles: string[];
  nonce: string;
  language: "en" | "th";
  preferredProviderSort: "latency" | "throughput";
  fallbackProviderSort: "latency" | "throughput";
  onProgress?: (completed: number, planItem: QuizPlanItem | null) => void;
}): Promise<SplitResult> {
  const {
    exampleAngles,
    recentAvoidAngles,
    nonce,
    language,
    preferredProviderSort,
    fallbackProviderSort,
    onProgress,
  } = opts;
  const routing = splitRouting(language);

  // 1. Planner — small, fast on any provider.
  const plannerSystemPrompt = buildQuizPlannerPrompt(
    exampleAngles,
    recentAvoidAngles,
    language,
  );
  const plannerUserPrompt = `Plan the quiz now for nonce=${nonce}.`;
  let plan: NonNullable<ReturnType<typeof quizPlanSchema.safeParse>["data"]> | null = null;
  let plannerTimedOut = false;
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    const isFallback = attempt === 1;
    const model = isFallback ? routing.fallbackModel : routing.primaryModel;
    const providerOrder = isFallback
      ? routing.fallbackProviders
      : routing.primaryProviders;
    try {
      const parsed = await callLlm({
        systemPrompt: plannerSystemPrompt,
        userPrompt: plannerUserPrompt,
        model,
        providerOrder,
        responseFormat: QUIZ_PLAN_RESPONSE_FORMAT,
        temperature: routing.temperature,
        maxTokens: 500,
        timeoutMs: isFallback ? 30_000 : 15_000,
        nonce: `${nonce}:plan:${attempt}`,
        purpose: "generate-quiz-plan",
        providerSort: attempt === 0 ? preferredProviderSort : fallbackProviderSort,
      });
      const candidate = quizPlanSchema.safeParse(parsed);
      if (candidate.success) plan = candidate.data;
    } catch (err) {
      if (isTimeoutError(err)) plannerTimedOut = true;
      console.warn(
        `[generate-quiz] planner attempt ${attempt + 1} failed`,
        err,
      );
    }
  }
  if (!plan) {
    console.warn("[generate-quiz] split pipeline: planner failed; falling back");
    return { ok: false, timeout: plannerTimedOut };
  }

  // 2. Writers — 8 parallel single-question calls, bounded concurrency.
  //    Count successful writes as they land so the SSE client can show a
  //    "writing n/8" progress beat instead of a static spinner.
  let completedWriters = 0;
  const slots = await mapWithConcurrency(
    plan.questions,
    WRITER_CONCURRENCY,
    (item, index) =>
      writeOneQuestion(
        item,
        index,
        nonce,
        language,
        preferredProviderSort,
        fallbackProviderSort,
      ).then((result) => {
        if (result) {
          completedWriters += 1;
          onProgress?.(completedWriters, item);
        }
        return { index, result };
      }),
  );

  // 3. Reconcile: retry any failed questions once more, serially, on the
  //    fallback model. A single flaky writer shouldn't sink the whole batch.
  const drafts: (NonNullable<ReturnType<typeof quizQuestionDraftSchema.safeParse>["data"]> | null)[] =
    slots.map((slot) => slot.result?.draft ?? null);
  for (let i = 0; i < drafts.length; i++) {
    if (drafts[i]) continue;
    const retried = await writeOneQuestion(
      plan.questions[i],
      i,
      nonce,
      language,
      fallbackProviderSort,
      preferredProviderSort,
    );
    drafts[i] = retried?.draft ?? null;
    if (drafts[i]) {
      completedWriters += 1;
      onProgress?.(completedWriters, plan.questions[i]);
    }
  }

  // 4. If any question is still missing, bail to the single-call path rather
  //    than shipping fewer than 8 questions.
  if (drafts.some((draft) => draft === null)) {
    console.warn(
      "[generate-quiz] split pipeline: some writers failed after retries; falling back",
    );
    return { ok: false, timeout: false };
  }

  // 4b. Opening-variety guard: parallel writers sometimes converge on the
  //     model's strongest prior (e.g. Thai "หลังเลิกงานเหนื่อยๆ") despite the
  //     planner assigning distinct scenes. Detect questions whose openings
  //     collide and re-roll the later duplicates once, with a hard "use your
  //     assigned scene, not this one" nudge. Deterministic — doesn't rely on
  //     the model obeying the first time.
  const reRolled = await dedupeQuestionOpenings(
    drafts as NonNullable<ReturnType<typeof quizQuestionDraftSchema.safeParse>["data"]>[],
    plan.questions,
    nonce,
    language,
    preferredProviderSort,
    fallbackProviderSort,
  );

  const questions = reRolled.map((draft, i) => {
    const planItem = plan!.questions[i];
    return {
      id: i + 1,
      angle: planItem.angle,
      text: draft.text,
      options: draft.options,
    };
  });

  // 5. Same script + spelling guards the single-call path uses.
  if (!hasExpectedScript(questions, language)) {
    console.warn(
      "[generate-quiz] split pipeline: output contained unexpected script; falling back",
    );
    return { ok: false, timeout: false };
  }

  const corrected = questions.map((question) => ({
    id: question.id,
    text: language === "th" ? correctThaiText(question.text) : question.text,
    options: question.options.map((option) => ({
      text: language === "th" ? correctThaiText(option.text) : option.text,
    })),
  }));

  return {
    ok: true,
    questions: corrected,
    pickedAngles: questions.map((question) => question.angle),
  };
}

/** Tiny error type so the worker can throw non-fatal failures (schema/script
 *  validation failed, timeout) with a structured envelope that the SSE path
 *  translates into an `event: error` and the JSON path returns directly. */
class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : "HTTP error");
  }
}

interface GenerateQuizResult {
  questions: QuizQuestion[];
  pickedAngles: string[];
}

/** The full quiz-generation worker, shared by both the JSON and SSE response
 *  paths. `progress` fires at each phase boundary so the client can animate a
 *  "planning → writing n/8" loading story instead of one static spinner.
 *
 *  Throws `HttpError` for recoverable failures (schema 502, timeout 504) and
 *  lets unexpected errors propagate. Both POST branches know how to render
 *  either as a response. */
async function runQuizGeneration(
  parsed: { avoidAngles: string[]; language: "en" | "th"; nonce: string | undefined },
  progress: QuizProgressCallback,
): Promise<GenerateQuizResult> {
  const { avoidAngles, language, nonce } = parsed;
  // Retain the most recent angles only. Sending an unbounded session history
  // consumes context without making the next questions more distinct.
  const recentAvoidAngles = avoidAngles.slice(-MAX_AVOID_ANGLES_IN_PROMPT);

  // Sample a fresh batch of style-reference angles from the static pool.
  // These are only few-shot examples now — the model invents the actual
  // angles it uses per call, so variety is no longer capped at the pool's
  // size.
  const exampleAngles = pickAngles(
    QUESTION_ANGLES,
    EXAMPLE_ANGLE_COUNT,
    new Set(recentAvoidAngles),
  );

  const requestNonce = nonce ?? cryptoRandomNonce();
  const needsThaiCopy = language === "th";
  const temperature = needsThaiCopy ? 0.7 : 0.9;
  const providerOrder = needsThaiCopy
    ? THAI_QUIZ_PROVIDER_ORDER
    : resolveProviderOrder();
  const preferredProviderSort = process.env.OPENROUTER_PROVIDER_SORT === "latency"
    ? "latency"
    : "throughput";
  const fallbackProviderSort = preferredProviderSort === "throughput"
    ? "latency"
    : "throughput";

  // Track whether either attempt failed with a timeout specifically (vs a
  // schema/script failure). Surfaced as a clean 504 below so the client
  // prefetch UI can show a recognizable "model is slow, try again" message
  // instead of a generic "validation failed" 502.
  let lastErrorWasTimeout = false;

  // Split fast path (both languages): a tiny planner + 8 parallel
  // single-question writers. This preserves the full language writing rules
  // (each writer gets them, focused on one question) while collapsing
  // wall-clock time, because no single call emits more than ~200 tokens.
  // Any failure falls through to the proven single-call path below, so the
  // batch never ships fewer than 8 questions.
  progress({ stage: "planning", completed: 0, total: quizConfig.questionCount });
  const split = await generateQuizSplit({
    exampleAngles,
    recentAvoidAngles,
    nonce: requestNonce,
    language,
    preferredProviderSort,
    fallbackProviderSort,
    onProgress: (completed, planItem) =>
      progress({
        stage: "writing",
        completed,
        total: quizConfig.questionCount,
        thought: planItem ? planItem.thought : undefined,
      }),
  });
  if (split.ok) {
    return { questions: split.questions, pickedAngles: split.pickedAngles };
  }
  // Split pipeline fell back — continue to the single-call path. Preserve
  // any planner timeout signal so a subsequent timeout isn't mislabeled.
  lastErrorWasTimeout = split.timeout || lastErrorWasTimeout;

  const systemPrompt = buildQuizSystemPrompt(
    exampleAngles,
    recentAvoidAngles,
    language,
  );
  const userPrompt = `Generate the quiz now for nonce=${requestNonce}. Invent ${quizConfig.questionCount} distinct angles as instructed, then write the question for each.`;

  let validation: ReturnType<typeof quizPayloadSchema.safeParse> | null = null;
  // 2 attempts: single-language output is faster to generate, and a third
  // slow retry costs more latency than it's worth.
  for (let attempt = 0; attempt < 2; attempt++) {
    let parsedLlm: unknown;
    // On retry, switch to a DIFFERENT model entirely (when one is
    // configured) and rotate the explicit provider order. Rotating
    // providers within the same model often re-hits the same backend
    // during a congestion event — using a different model is the
    // real timeout fix. See THAI_QUIZ_FALLBACK_MODEL above.
    const isFallbackAttempt = attempt === 1 && needsThaiCopy;
    const attemptProviderOrder = isFallbackAttempt
      ? THAI_QUIZ_FALLBACK_PROVIDER_ORDER
      : (attempt === 0
        ? providerOrder
        : [...providerOrder.slice(1), providerOrder[0]]);
    const attemptModel = isFallbackAttempt
      ? THAI_QUIZ_FALLBACK_MODEL
      : (needsThaiCopy ? THAI_QUIZ_MODEL : undefined);
    try {
      parsedLlm = await callLlm({
        systemPrompt,
        userPrompt,
        ...(attemptModel ? { model: attemptModel } : {}),
        providerOrder: attemptProviderOrder,
        responseFormat: QUIZ_RESPONSE_FORMAT,
        temperature,
        // 8-question Thai quiz on Groq: 1500 tokens at 321 tok/s = ~5s of
        // generation + ~300ms latency. The 22s budget is a 4x safety margin
        // against Groq hiccups and the slightly-longer Thai prompt. The
        // fallback (deepseek-v4-flash at 76 tok/s on BaseTen) needs ~20s,
        // so its budget stays at 30s.
        maxTokens: needsThaiCopy ? 1500 : 2000,
        // Groq p99 latency on qwen3-32b is ~1.9s; 22s is a 10x+ safety
        // margin and absorbs occasional throughput dips without retrying.
        timeoutMs: isFallbackAttempt ? 30_000 : 22_000,
        nonce: `${requestNonce}:${attempt}`,
        purpose: "generate-quiz",
        providerSort:
          attempt === 0 ? preferredProviderSort : fallbackProviderSort,
      });
    } catch (err) {
      const isAbort = err instanceof Error
        && (err.name === "TimeoutError" || /aborted due to timeout/i.test(err.message));
      if (isAbort) lastErrorWasTimeout = true;
      console.warn(
        attempt === 0
          ? `[generate-quiz] attempt 1 failed via model=${attemptModel ?? "default"} providers=${attemptProviderOrder.join(", ")}; retrying via model=${THAI_QUIZ_FALLBACK_MODEL} providers=${THAI_QUIZ_FALLBACK_PROVIDER_ORDER.join(", ")}`
          : `[generate-quiz] attempt 2 failed via model=${attemptModel ?? "default"} providers=${attemptProviderOrder.join(", ")}`,
        err,
      );
      continue;
    }

    // Safety net: small open-source models routed through Groq/DeepInfra
    // frequently collapse `{"text":"..."}` options into bare strings, and
    // some flatten the question object itself. Normalize the output back
    // into the schema before validating so a single stringly-typed response
    // doesn't burn a 25s retry on an otherwise-correct output.
    normalizeLlmQuizShape(parsedLlm);

    const candidate = quizPayloadSchema.safeParse(parsedLlm);
    validation = candidate;
    if (candidate.success && !hasExpectedScript(candidate.data.questions, language)) {
      console.warn(
        `[generate-quiz] attempt ${attempt + 1} contained text outside the requested ${language} script; retrying`,
      );
      validation = null;
    }
    if (validation?.success) break;
  }

  if (!validation || !validation.success) {
    // If both attempts failed with a timeout (vs a schema/script error),
    // surface a 504 so the client prefetch UI can show a recognizable
    // "model is slow" message instead of a generic "validation failed"
    // 502. Falling through to 502 here would also be misleading because
    // the model DID respond, just past the timeout.
    if (lastErrorWasTimeout) {
      throw new HttpError(504, {
        error: "LLM request timed out after 2 attempts.",
        code: "timeout",
      });
    }
    throw new HttpError(502, {
      error: "LLM output failed schema validation.",
      issues: validation?.error.issues,
    });
  }

  // The model invents its own angle per question (see quizSystemPrompt.ts);
  // surface those as `pickedAngles` so the client can keep avoiding them on
  // future calls. Strip the internal `angle` field from each question
  // before returning — it's not part of the public question shape the
  // client renders. Also apply Thai post-corrections only when the quiz
  // is Thai; leave English text untouched.
  const pickedAngles = validation.data.questions.map((q) => q.angle);
  const questions = validation.data.questions.map(
    ({ angle: _angle, text, options, ...question }) => ({
      ...question,
      text: language === "th" ? correctThaiText(text) : text,
      options: options.map((option) => ({
        text: language === "th" ? correctThaiText(option.text) : option.text,
      })),
    }),
  );

  return { questions, pickedAngles };
}

/** POST /api/generate-quiz — LLM call #1: generate the quiz questions.
 *  Body: { language: "en" | "th", avoidAngles?: string[], nonce?: string }
 *
 *  Two response modes:
 *   - JSON (default): returns { questions, pickedAngles } as a single body.
 *   - SSE (opt-in via `Accept: text/event-stream`): streams progress events
 *     (`planning` → `writing n/8`) then `event: result` with the payload. */
export async function POST(request: Request) {
  // Parse optional request metadata defensively. A stale bundle can send an
  // old or malformed shape; discard unknown fields rather than failing
  // before the quiz can be generated. `language` is required though —
  // see parseRequestBody for why a silent fallback would override the
  // user's UI selection on a stale bundle.
  const raw = await request.json().catch(() => ({}));
  const parsed = parseRequestBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (wantsEventStream(request)) {
    const stream = quizSseStream((progress) => runQuizGeneration(parsed, progress));
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable reverse-proxy buffering so events reach the client as
        // they're written instead of being held until the response closes.
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    return NextResponse.json(await runQuizGeneration(parsed, () => {}));
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    console.error("[generate-quiz]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to generate quiz.", detail: message },
      { status: 500 },
    );
  }
}

/** Tiny non-crypto random for the fallback user-prompt nonce. Only used
 *  inside the prompt itself to nudge the LLM toward a fresh roll; the real
 *  uniqueness guarantee for the in-flight mutex comes from the caller's
 *  `nonce` parameter. */
function cryptoRandomNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}
