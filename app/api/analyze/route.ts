import { NextResponse } from "next/server";

import { analyzeFailureDiagnostic, runAnalyze } from "@/lib/analyze";
import {
  sseStream,
  wantsEventStream,
  type ProgressCallback,
} from "@/lib/analyzeProgress";
import { analyzeBodySchema } from "@/lib/profileAssessment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function analyze(
  input: Parameters<typeof runAnalyze>[0],
  progress: ProgressCallback,
) {
  try {
    return await runAnalyze(input, progress);
  } catch (error) {
    console.warn(
      "[analyze] failed",
      analyzeFailureDiagnostic(error),
    );
    throw new Error("Could not finish your reading. Please try again.");
  }
}

/** Assesses quiz answers and generates the current profile reveal. */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  if (raw === null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = analyzeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid quiz answers." }, { status: 400 });
  }

  if (wantsEventStream(request)) {
    return new Response(
      sseStream((progress) => analyze(parsed.data, progress)),
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
    return NextResponse.json(await analyze(parsed.data, () => {}));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to analyze answers." },
      { status: 502 },
    );
  }
}
