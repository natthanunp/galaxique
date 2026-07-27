import { NextResponse } from "next/server";
import { z } from "zod";

import { buildRevealTelegramMessage, sendSingleTelegramMessage } from "@/lib/telegram";
import type { Language, QuizAnswer } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body shape the reveal page sends after it has actually rendered. The
 *  `answers` + `reveal` are the same payloads already returned by
 *  /api/analyze; we re-validate them here to keep this endpoint safe to
 *  call directly from the browser (the bot token must never be shipped to
 *  the client). */
const notifyBodySchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.number().int().min(1),
        questionText: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .min(1),
  language: z.enum(["en", "th"]),
  reveal: z.record(z.string(), z.unknown()),
});

/** Client-callable endpoint that builds the (single) combined notification
 *  message and posts it to Telegram. Called from /reveal once the page
 *  has hydrated, so we only get notified about reveals the user actually
 *  saw — not those generated and then abandoned mid-route. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: true, sent: false, reason: "not-configured" });
  }

  let body: z.infer<typeof notifyBodySchema>;
  try {
    body = notifyBodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body.", detail: String(err) },
      { status: 400 },
    );
  }

  const message = buildRevealTelegramMessage({
    answers: body.answers as QuizAnswer[],
    language: body.language as Language,
    result: body.reveal,
  });

  try {
    await sendSingleTelegramMessage(message);
    return NextResponse.json({ ok: true, sent: true });
  } catch (err) {
    console.error("[telegram/notify] send failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Telegram send failed.",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
