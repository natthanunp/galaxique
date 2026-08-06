import { NextResponse } from "next/server";

import { callLlm, resolveProviderOrder } from "@/lib/llm";
import { quizPayloadSchema } from "@/lib/schemas";
import { buildQuizSystemPrompt } from "@/prompts/quizSystemPrompt";
import { quizConfig, QUESTION_ANGLES } from "@/config/quizConfig";

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
 * script instruction. Reject visible text that contains letters from another
 * writing system, e.g. Thai mixed with Cyrillic, then let the existing retry
 * produce a clean quiz rather than showing malformed copy to the user.
 */
function usesExpectedScript(text: string, language: "en" | "th"): boolean {
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    const isExpected = language === "th"
      ? THAI_LETTER.test(character)
      : LATIN_LETTER.test(character);
    if (!isExpected) return false;
  }
  return true;
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

/** POST /api/generate-quiz — LLM call #1: generate the quiz questions.
 *  Body: { language: "en" | "th", avoidAngles?: string[], nonce?: string } */
export async function POST(request: Request) {
  try {
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
    const systemPrompt = buildQuizSystemPrompt(
      exampleAngles,
      recentAvoidAngles,
      language,
    );
    const userPrompt = `Generate the quiz now for nonce=${requestNonce}. Invent ${quizConfig.questionCount} distinct angles as instructed, then write the question for each.`;
    const preferredProviderSort = process.env.OPENROUTER_PROVIDER_SORT === "latency"
      ? "latency"
      : "throughput";
    const fallbackProviderSort = preferredProviderSort === "throughput"
      ? "latency"
      : "throughput";
    const needsThaiCopy = language === "th";
    const temperature = needsThaiCopy ? 0.7 : 0.9;
    const providerOrder = needsThaiCopy
      ? THAI_QUIZ_PROVIDER_ORDER
      : resolveProviderOrder();

    let validation: ReturnType<typeof quizPayloadSchema.safeParse> | null = null;
    // Track whether either attempt failed with a timeout specifically (vs a
    // schema/script failure). Surfaced as a clean 504 below so the client
    // prefetch UI can show a recognizable "model is slow, try again" message
    // instead of a generic "validation failed" 502.
    let lastErrorWasTimeout = false;
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
          // generation + ~300ms latency. The 30s budget is wide-margin safety
          // against Groq hiccups; the previous tighter value (1500) caused
          // the 28s-timeout retry that surfaced in prod. The fallback
          // (deepseek-v4-flash at 76 tok/s on BaseTen) needs ~20s, so its
          // budget stays at 28s with the same headroom.
          maxTokens: needsThaiCopy ? 1500 : 2000,
          // Groq p99 latency on qwen3-32b is ~1.9s; 18s is a 10x safety
          // margin and turns a 2-3s typical generation into a tight-but-
          // reliable budget. The 30s/28s numbers in the prior config were
          // inherited from the slow DeepInfra era; they're no longer
          // warranted and just delay the user-visible error on a true hang.
          timeoutMs: isFallbackAttempt ? 28_000 : 18_000,
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
        return NextResponse.json(
          {
            error: "LLM request timed out after 2 attempts.",
            code: "timeout",
          },
          { status: 504 },
        );
      }
      return NextResponse.json(
        {
          error: "LLM output failed schema validation.",
          issues: validation?.error.issues,
        },
        { status: 502 },
      );
    }

    // The model invents its own angle per question (see quizSystemPrompt.ts);
    // surface those as `pickedAngles` so the client can keep avoiding them on
    // future calls. Strip the internal `angle` field from each question
    // before returning — it's not part of the public question shape the
    // client renders.
    const pickedAngles = validation.data.questions.map((q) => q.angle);
    const questions = validation.data.questions.map(
      ({ angle: _angle, ...question }) => question,
    );

    return NextResponse.json({ questions, pickedAngles });
  } catch (err) {
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
