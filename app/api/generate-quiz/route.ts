import { NextResponse } from "next/server";
import { z } from "zod";

import { callLlm } from "@/lib/llm";
import { quizPayloadSchema } from "@/lib/schemas";
import { buildQuizSystemPrompt } from "@/prompts/quizSystemPrompt";
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
  /** A unique token per request — used to break the LLM call mutex so a
   *  retry isn't aliased to the previous in-flight call. Optional; the server
   *  generates one if absent. */
  nonce: z.string().max(100).optional(),
});

/** How many entries from the static QUESTION_ANGLES pool to show the LLM as
 *  style/depth reference examples per call. The model invents its own real
 *  angles — these are just grounding examples, not a fixed menu — so this
 *  can be smaller than questionCount without capping variety. */
const EXAMPLE_ANGLE_COUNT = 10;

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
    const avoidAngles = parsed.success ? parsed.data.avoidAngles ?? [] : [];
    const nonce = parsed.success ? parsed.data.nonce : undefined;

    // Sample a fresh batch of style-reference angles from the static pool.
    // These are only few-shot examples now — the model invents the actual
    // angles it uses per call, so variety is no longer capped at the pool's
    // size.
    const count = quizConfig.questionCount;
    const exampleAngles = pickAngles(
      QUESTION_ANGLES,
      EXAMPLE_ANGLE_COUNT,
      new Set(avoidAngles),
    );

    const systemPrompt = buildQuizSystemPrompt(exampleAngles, avoidAngles);
    const userPrompt = `Generate the quiz now for nonce=${nonce ?? cryptoRandomNonce()}. Invent ${count} distinct angles as instructed, then write the question for each.`;

    let validation: ReturnType<typeof quizPayloadSchema.safeParse> | null =
      null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parsedLlm = await callLlm({
        systemPrompt,
        userPrompt,
        temperature: 0.9,
        // 4 bilingual MCQ options per question roughly quadruples the output
        // text vs. question-text-only, so this needs meaningfully more room
        // than the old free-text-answer format's 3072.
        maxTokens: 4096,
        // This much larger payload (5 questions \u00d7 4 bilingual options each)
        // routinely needs more than the default 20s timeout, which was
        // causing "aborted due to timeout" 500s even on successful
        // generations that just took a bit longer than analyze's simpler
        // payload. Give it real headroom.
        timeoutMs: 40_000,
        nonce,
        purpose: "generate-quiz",
      });

      // Safety net: some providers (Groq) don't enforce schema, so the model
      // may omit the `id` field. Auto-assign 1-based IDs if missing.
      const rawLlm = parsedLlm as { questions?: { id?: number }[] };
      if (rawLlm.questions) {
        rawLlm.questions = rawLlm.questions.map((q, i) => ({
          ...q,
          id: typeof q.id === "number" ? q.id : i + 1,
        }));
      }

      validation = quizPayloadSchema.safeParse(rawLlm);
      if (validation.success) break;
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
