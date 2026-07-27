import { NextResponse } from "next/server";
import { z } from "zod";

import { callLlm } from "@/lib/llm";
import { legacyQuizPayloadSchema, quizPayloadSchema } from "@/lib/schemas";
import {
  buildLegacyBilingualQuizSystemPrompt,
  buildQuizSystemPrompt,
} from "@/prompts/quizSystemPrompt";
import { quizConfig, QUESTION_ANGLES } from "@/config/quizConfig";

export const runtime = "nodejs";
// Quiz generation is dynamic per call; don't cache at the framework level.
export const dynamic = "force-dynamic";

/** Body schema — both fields are optional. `avoidAngles` lets the client tell
 *  the server which angles it's already seen this session, so a refresh or
 *  retry can produce a meaningfully different set. We cap the array length to
 *  keep the prompt bounded. */
const requestBodySchema = z.object({
  avoidAngles: z.array(z.string()).max(50).optional(),
  /** v2 clients send an explicit language and receive a single-language
   *  payload. Its absence identifies the v1 bilingual contract, which must
   *  remain available for an already-open pre-deploy browser tab. */
  language: z.enum(["en", "th"]).optional(),
  /** A unique token per request — used to break the LLM call mutex so a
   *  retry isn't aliased to the previous in-flight call. Optional; the server
   *  generates one if absent. */
  nonce: z.string().max(100).optional(),
});

/** How many entries from the static QUESTION_ANGLES pool to show the LLM as
 *  style/depth reference examples per call. The model invents its own real
 *  angles — these are just grounding examples, not a fixed menu — so this
 *  can be smaller than questionCount without capping variety. */
const EXAMPLE_ANGLE_COUNT = 5;
const MAX_AVOID_ANGLES_IN_PROMPT = 12;
const LEGACY_QUESTION_COUNT = 5;
const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const THAI_LETTER = /\p{Script=Thai}/u;

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

function hasExpectedLegacyScripts(
  questions: {
    text_en: string;
    text_th: string;
    options: { text_en: string; text_th: string }[];
  }[],
): boolean {
  return questions.every(
    (question) =>
      usesExpectedScript(question.text_en, "en") &&
      usesExpectedScript(question.text_th, "th") &&
      question.options.every(
        (option) =>
          usesExpectedScript(option.text_en, "en") &&
          usesExpectedScript(option.text_th, "th"),
      ),
  );
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

/** POST /api/generate-quiz — LLM call #1: generate bilingual quiz questions.
 *  Body (all optional): { avoidAngles?: string[], nonce?: string } */
export async function POST(request: Request) {
  try {
    // Parse the body defensively. A missing or malformed body is fine — we
    // just regenerate with no avoidance context.
    const raw = await request.json().catch(() => ({}));
    const parsed = requestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }
    const avoidAngles = parsed.data.avoidAngles ?? [];
    const language = parsed.data.language;
    const legacyClient = language === undefined;
    // Retain the most recent angles only. Sending an unbounded session history
    // consumes context without making the next five questions more distinct.
    const recentAvoidAngles = avoidAngles.slice(-MAX_AVOID_ANGLES_IN_PROMPT);
    const nonce = parsed.data.nonce;

    // Sample a fresh batch of style-reference angles from the static pool.
    // These are only few-shot examples now — the model invents the actual
    // angles it uses per call, so variety is no longer capped at the pool's
    // size.
    const count = legacyClient ? LEGACY_QUESTION_COUNT : quizConfig.questionCount;
    const exampleAngles = pickAngles(
      QUESTION_ANGLES,
      EXAMPLE_ANGLE_COUNT,
      new Set(recentAvoidAngles),
    );

    const requestNonce = nonce ?? cryptoRandomNonce();
    const systemPrompt = legacyClient
      ? buildLegacyBilingualQuizSystemPrompt(
          exampleAngles,
          recentAvoidAngles,
          count,
        )
      : buildQuizSystemPrompt(exampleAngles, recentAvoidAngles, language);
    const userPrompt = `Generate the quiz now for nonce=${requestNonce}. Invent ${count} distinct angles as instructed, then write the question for each.`;
    const preferredProviderSort = process.env.OPENROUTER_PROVIDER_SORT === "latency"
      ? "latency"
      : "throughput";
    const fallbackProviderSort = preferredProviderSort === "throughput"
      ? "latency"
      : "throughput";

    let validation:
      | ReturnType<typeof quizPayloadSchema.safeParse>
      | ReturnType<typeof legacyQuizPayloadSchema.safeParse>
      | null = null;
    // 2 attempts, not 3: single-language output is faster to generate, and a
    // third slow retry costs more latency than it's worth.
    for (let attempt = 0; attempt < 2; attempt++) {
      let parsedLlm: unknown;
      try {
        parsedLlm = await callLlm({
          systemPrompt,
          userPrompt,
          temperature: 0.9,
          // v1 uses the original five bilingual questions; v2 keeps the
          // faster ten-question single-language format.
          maxTokens: legacyClient ? 2400 : 3200,
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

      // Safety net: some providers (Groq) don't enforce schema, so the model
      // may omit the `id` field. Auto-assign 1-based IDs if missing.
      const rawLlm = parsedLlm as { questions?: { id?: number }[] };
      if (rawLlm.questions) {
        rawLlm.questions = rawLlm.questions.map((q, i) => ({
          ...q,
          id: typeof q.id === "number" ? q.id : i + 1,
        }));
      }

      if (legacyClient) {
        const candidate = legacyQuizPayloadSchema.safeParse(rawLlm);
        validation = candidate;
        if (candidate.success && !hasExpectedLegacyScripts(candidate.data.questions)) {
          console.warn(
            `[generate-quiz] attempt ${attempt + 1} contained mixed-script legacy quiz text; retrying`,
          );
          validation = null;
        }
      } else {
        const candidate = quizPayloadSchema.safeParse(rawLlm);
        validation = candidate;
        if (candidate.success && !hasExpectedScript(candidate.data.questions, language)) {
          console.warn(
            `[generate-quiz] attempt ${attempt + 1} contained text outside the requested ${language} script; retrying`,
          );
          validation = null;
        }
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
    // future calls, same contract as before. Strip the internal `angle` field
    // from each question before returning — it's not part of the public
    // question shape the client renders.
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
