import { NextResponse } from "next/server";

import { wantsEventStream } from "@/lib/analyzeProgress";
import { generateBalancedQuiz } from "@/lib/quiz";
import {
  quizSseStream,
  type QuizProgressCallback,
} from "@/lib/quizProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateQuizInput {
  avoidAngles: string[];
  language: "en" | "th";
  nonce?: string;
}

function parseRequestBody(raw: unknown):
  | { ok: true; data: GenerateQuizInput }
  | { ok: false; error: string } {
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
    data: {
      language: body.language,
      avoidAngles: Array.isArray(body.avoidAngles)
        ? body.avoidAngles
            .filter((angle): angle is string => typeof angle === "string")
            .slice(-50)
        : [],
      nonce: typeof body.nonce === "string" && body.nonce.length <= 100
        ? body.nonce
        : undefined,
    },
  };
}

async function runQuizGeneration(
  input: GenerateQuizInput,
  progress: QuizProgressCallback,
) {
  try {
    return await generateBalancedQuiz(input, progress);
  } catch (error) {
    console.warn(
      "[generate-quiz] failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    throw new Error("Could not finish all eight questions. Please try again.");
  }
}

/** Generates a new AI-authored quiz for every request. */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = parseRequestBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (wantsEventStream(request)) {
    return new Response(
      quizSseStream((progress) => runQuizGeneration(parsed.data, progress)),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      },
    );
  }

  try {
    return NextResponse.json(await runQuizGeneration(parsed.data, () => {}));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate quiz." },
      { status: 502 },
    );
  }
}
