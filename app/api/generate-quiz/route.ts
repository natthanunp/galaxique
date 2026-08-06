import { NextResponse } from "next/server";

import { callLlm } from "@/lib/llm";
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
const THAI_QUIZ_MODEL =
  process.env.OPENROUTER_THAI_QUIZ_MODEL || "deepseek/deepseek-v4-flash-0731";
const THAI_QUIZ_PROVIDER_ORDER = (
  process.env.OPENROUTER_THAI_QUIZ_PROVIDER_ORDER || "alibaba,deepinfra"
)
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);

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

    let validation: ReturnType<typeof quizPayloadSchema.safeParse> | null = null;
    // 2 attempts: single-language output is faster to generate, and a third
    // slow retry costs more latency than it's worth.
    for (let attempt = 0; attempt < 2; attempt++) {
      let parsedLlm: unknown;
      try {
        parsedLlm = await callLlm({
          systemPrompt,
          userPrompt,
          ...(needsThaiCopy
            ? {
                model: THAI_QUIZ_MODEL,
                providerOrder: THAI_QUIZ_PROVIDER_ORDER,
              }
            : {}),
          temperature,
          maxTokens: 3200,
          timeoutMs: 25_000,
          nonce: `${requestNonce}:${attempt}`,
          purpose: "generate-quiz",
          providerSort:
            attempt === 0 ? preferredProviderSort : fallbackProviderSort,
        });
      } catch (err) {
        console.warn(
          `[generate-quiz] attempt ${attempt + 1} failed; retrying with ${fallbackProviderSort} routing`,
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
