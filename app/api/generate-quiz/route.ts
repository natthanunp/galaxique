import { NextResponse } from "next/server";

import { wantsEventStream } from "@/lib/analyzeProgress";
import { QUIZ_GENERATION_METRICS } from "@/lib/quiz";
import { runSharedQuizJob } from "@/lib/quizJobs";
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

function metricsFrom(value: unknown) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  return (value as { [QUIZ_GENERATION_METRICS]?: {
    elapsedMs: number;
    initialAccepted: number;
    repairRounds: number;
    repairCalls: number;
    requestCount: number;
    failedRequestCount: number;
    promptTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    missingUsageCount: number;
    providers: string[];
    finishReasons: string[];
  } })[QUIZ_GENERATION_METRICS];
}

function quizMetricHeaders(metrics: NonNullable<ReturnType<typeof metricsFrom>>): Record<string, string> {
  return {
    "Server-Timing": `quiz;dur=${metrics.elapsedMs}`,
    "X-Quiz-Initial-Accepted": String(metrics.initialAccepted),
    "X-Quiz-Repair-Rounds": String(metrics.repairRounds),
    "X-Quiz-Repair-Calls": String(metrics.repairCalls),
    "X-Quiz-Request-Count": String(metrics.requestCount),
    "X-Quiz-Failed-Requests": String(metrics.failedRequestCount),
    "X-Quiz-Prompt-Tokens": String(metrics.promptTokens),
    "X-Quiz-Output-Tokens": String(metrics.outputTokens),
    "X-Quiz-Reasoning-Tokens": String(metrics.reasoningTokens),
    "X-Quiz-Cost-Usd": String(metrics.costUsd),
    "X-Quiz-Missing-Usage": String(metrics.missingUsageCount),
    "X-Quiz-Providers": metrics.providers.join(","),
    "X-Quiz-Finish-Reasons": metrics.finishReasons.join(","),
  };
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
    return await runSharedQuizJob(input, progress);
  } catch (error) {
    console.warn(
      "[generate-quiz] failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    const publicError = new Error("Could not finish all eight questions. Please try again.");
    const metrics = metricsFrom(error);
    if (metrics) {
      Object.defineProperty(publicError, QUIZ_GENERATION_METRICS, { value: metrics });
    }
    throw publicError;
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
    const result = await runQuizGeneration(parsed.data, () => {});
    const metrics = result[QUIZ_GENERATION_METRICS];
    return NextResponse.json(result, {
      headers: quizMetricHeaders(metrics),
    });
  } catch (error) {
    const metrics = metricsFrom(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate quiz." },
      { status: 502, ...(metrics ? { headers: quizMetricHeaders(metrics) } : {}) },
    );
  }
}
