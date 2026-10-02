import { NextResponse } from "next/server";
import { z } from "zod";

import { getConversationHistory, appendMessage } from "@/lib/creatureChatStore";
import { generateCreatureReply } from "@/lib/creatureReply";
import { sanitizeLlmError } from "@/lib/llmError";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { loadReveal } from "@/lib/revealStore";
import { buildCreatureChatPrompt } from "@/prompts/creatureChatPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(8).max(64).regex(/^[\w-]+$/),
  message: z.string().trim().min(1).max(500),
  revealId: z.string().uuid(),
  revealToken: z.string().min(16).max(128),
  language: z.enum(["en", "th"]).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  }
  const { sessionId, message, revealId, revealToken } = parsed.data;

  const perVisitor = await rateLimit("chat-ip", clientKey(request), 30, 600);
  if (!perVisitor.ok) return tooManyRequests(perVisitor.retryAfter);
  const perWorld = await rateLimit("chat-reveal", revealId, 120, 3600);
  if (!perWorld.ok) return tooManyRequests(perWorld.retryAfter);

  try {
    // World data comes only from the server copy; the client sends an ID and token.
    const stored = await loadReveal(revealId, revealToken);
    if (!stored) {
      return NextResponse.json({ success: false, error: "reveal_unavailable" }, { status: 404 });
    }
    const { reveal } = stored;
    const language = parsed.data.language ?? stored.language;
    const creatureName = reveal.creature?.name ?? (language === "th" ? "เพื่อนคู่ใจ" : "Companion");
    const historyKey = `${revealId}:${sessionId}`;

    await appendMessage(historyKey, { role: "user", content: message, timestamp: Date.now() });
    const history = await getConversationHistory(historyKey);
    const transcript = history.slice(-5).map((entry) => ({
      from: entry.role === "user" ? "visitor" : creatureName,
      text: entry.content,
    }));

    const reply = await generateCreatureReply(
      buildCreatureChatPrompt(reveal, language), { conversation: transcript }, language, "creature-chat",
    );
    if (!reply.fallback) {
      await appendMessage(historyKey, { role: "creature", content: reply.text, timestamp: Date.now() });
    }
    return NextResponse.json({ success: true, response: reply.text, emotion: reply.emotion, creatureName });
  } catch (error) {
    const safeError = sanitizeLlmError(error);
    console.error("[creature-chat] Error:", {
      name: safeError.name, kind: safeError.kind, status: safeError.statusCode, provider: safeError.provider,
    });
    return NextResponse.json({ success: false, response: null, error: "failed" }, { status: 500 });
  }
}
