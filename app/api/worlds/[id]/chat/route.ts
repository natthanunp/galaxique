import { NextResponse } from "next/server";
import { z } from "zod";

import { appendMessage, getConversationHistory } from "@/lib/creatureChatStore";
import { generateCreatureReply } from "@/lib/creatureReply";
import { sanitizeLlmError } from "@/lib/llmError";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { getWorld } from "@/lib/worldStore";
import { buildVisitorChatPrompt } from "@/prompts/creatureChatPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  visitorId: z.string().regex(/^[a-f0-9-]{36}$/),
  message: z.string().trim().min(1).max(500),
  language: z.enum(["en", "th"]),
});

/** POST /api/worlds/{id}/chat — visitor chat, isolated per world and visitor. */
export async function POST(request: Request, ctx: RouteContext<"/api/worlds/[id]/chat">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  const { visitorId, message, language } = parsed.data;

  const perVisitor = await rateLimit("visit-chat-ip", clientKey(request), 30, 600);
  if (!perVisitor.ok) return tooManyRequests(perVisitor.retryAfter);
  const perWorld = await rateLimit("visit-chat-world", id, 300, 3600);
  if (!perWorld.ok) return tooManyRequests(perWorld.retryAfter);

  try {
    // The client sends only the world ID; content comes from the published snapshot.
    const world = await getWorld(id);
    if (!world) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    const historyKey = `visit:${id}:${visitorId}`;
    await appendMessage(historyKey, { role: "user", content: message, timestamp: Date.now() });
    const history = await getConversationHistory(historyKey);
    const reply = await generateCreatureReply(
      buildVisitorChatPrompt(world, language),
      { conversation: history.slice(-5).map((m) => ({ from: m.role === "user" ? "visitor" : world.creature.name, text: m.content })) },
      language,
      "visit-chat",
    );
    if (!reply.fallback) await appendMessage(historyKey, { role: "creature", content: reply.text, timestamp: Date.now() });
    return NextResponse.json({ success: true, response: reply.text, emotion: reply.emotion });
  } catch (error) {
    const safe = sanitizeLlmError(error);
    console.error("[visit-chat] Error:", { kind: safe.kind, status: safe.statusCode });
    return NextResponse.json({ success: false, error: "failed" }, { status: 500 });
  }
}
