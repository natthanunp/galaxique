import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { pickSongFlavorHint } from "@/config/quizConfig";
import { callLlm } from "@/lib/llm";
import { universeRevealSchema } from "@/lib/schemas";
import { sendAnalyzeResultToTelegram } from "@/lib/telegram";
import { buildRevealSystemPrompt } from "@/prompts/revealSystemPrompt";
import type { Language, QuizAnswer } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeBody {
  answers: QuizAnswer[];
  language: Language;
}

/** POST /api/analyze — LLM call #2: map answers → universe reveal JSON. */
export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return NextResponse.json(
      { error: "answers[] is required and must be non-empty." },
      { status: 400 },
    );
  }
  if (body.language !== "en" && body.language !== "th") {
    return NextResponse.json(
      { error: "language must be 'en' or 'th'." },
      { status: 400 },
    );
  }

  try {
    const songFlavorHint = pickSongFlavorHint();
    const systemPrompt = buildRevealSystemPrompt(songFlavorHint);

    // Format the answers as a readable transcript for the model.
    const transcript = body.answers
      .map(
        (a) =>
          `Q${a.questionId}: ${a.questionText}\nA: ${a.answer}`,
      )
      .join("\n\n");

    // A fresh nonce per incoming request is critical: callLlm() dedupes
    // concurrent calls sharing the same key onto one in-flight promise. The
    // previous code passed no nonce here (only `purpose: "analyze"`), so
    // TWO DIFFERENT USERS submitting the quiz around the same moment would
    // collapse onto a single shared result — same song, same creature, same
    // reading — regardless of how different their answers were. This was
    // the root cause of the "I always get the same song" report.
    const requestNonce = randomUUID();

    // The model occasionally drifts on a single enum field (e.g. picks a
    // synonym not in the allowed set). Retry a couple of times before
    // failing the whole request.
    let validation: ReturnType<typeof universeRevealSchema.safeParse> | null =
      null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const parsed = await callLlm({
          systemPrompt,
          userPrompt: transcript,
          temperature: 0.85,
          // Give the full reveal object enough room even when the provider
          // adds formatting or uses extra output tokens.
          maxTokens: 4096,
          nonce: `${requestNonce}:${attempt}`,
          purpose: "analyze",
        });
        validation = universeRevealSchema.safeParse(parsed);
      } catch (err) {
        console.warn(`[analyze] LLM attempt ${attempt + 1} failed`, err);
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

    try {
      await sendAnalyzeResultToTelegram({
        answers: body.answers,
        language: body.language,
        result: validation.data,
      });
    } catch (err) {
      console.error("[analyze] Telegram notification failed", err);
    }

    return NextResponse.json(validation.data);
  } catch (err) {
    console.error("[analyze]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to analyze answers.", detail: message },
      { status: 500 },
    );
  }
}
