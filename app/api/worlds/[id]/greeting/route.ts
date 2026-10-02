import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { generateCreatureReply } from "@/lib/creatureReply";
import { countMetric } from "@/lib/metrics";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { getRedis, V2_PREFIX } from "@/lib/redis";
import { getWorld } from "@/lib/worldStore";
import { buildVisitorChatPrompt } from "@/prompts/creatureChatPrompt";
import type { Language } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POOL_SIZE = 3;
const POOL_TTL_SECONDS = 30 * 86_400;
const VISITOR_ID = /^[a-f0-9-]{36}$/;

function fallbackGreeting(name: string, language: Language) {
  return language === "th"
    ? `สวัสดี! ฉันชื่อ${name} ยินดีต้อนรับสู่โลกของเรานะ ✨`
    : `Oh, hello! I'm ${name}. Welcome to our little world ✨`;
}

/** GET /api/worlds/{id}/greeting?lang=en|th&visitor=<id> — called on arrival, never on hover. */
export async function GET(request: Request, ctx: RouteContext<"/api/worlds/[id]/greeting">) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const language: Language = url.searchParams.get("lang") === "th" ? "th" : "en";
  const requestedVisitor = url.searchParams.get("visitor") ?? "";
  // Server-created per-visitor session ID for this planet's chat.
  const visitorId = VISITOR_ID.test(requestedVisitor) ? requestedVisitor : randomUUID();

  const limit = await rateLimit("greet-ip", clientKey(request), 40, 600);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const world = await getWorld(id);
  if (!world) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });

  const poolKey = `${V2_PREFIX}greet:${id}:${language}`;
  const redis = getRedis();
  const pool = redis ? await redis.lrange<{ text: string; emotion: string }>(poolKey, 0, -1) : [];
  if (pool.length >= POOL_SIZE) {
    countMetric("greeting:hit");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return NextResponse.json({ success: true, ...pick, visitorId, cached: true });
  }

  countMetric("greeting:miss");
  try {
    const reply = await generateCreatureReply(
      buildVisitorChatPrompt(world, language),
      { event: "A visitor just landed on your world. Greet them warmly in one or two short sentences, in character." },
      language,
      "creature-greeting",
    );
    if (reply.fallback) throw new Error("fallback");
    if (redis) {
      await redis.pipeline().rpush(poolKey, JSON.stringify({ text: reply.text, emotion: reply.emotion }))
        .ltrim(poolKey, 0, POOL_SIZE - 1).expire(poolKey, POOL_TTL_SECONDS).exec();
    }
    return NextResponse.json({ success: true, text: reply.text, emotion: reply.emotion, visitorId, cached: false });
  } catch {
    return NextResponse.json({
      success: true, text: fallbackGreeting(world.creature.name, language), emotion: "happy", visitorId, cached: false,
    });
  }
}
