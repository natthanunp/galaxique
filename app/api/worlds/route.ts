import { NextResponse } from "next/server";
import { z } from "zod";

import { countMetric } from "@/lib/metrics";
import { findPersonalInfo } from "@/lib/piiCheck";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { loadReveal } from "@/lib/revealStore";
import { buildSnapshot, listWorlds, publishedIdForReveal, publishWorld, summarize } from "@/lib/worldStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/worlds?before=<ms>&limit=<n> — newest published worlds, paged by time. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || Date.now() + 1;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  try {
    return NextResponse.json({ success: true, ...(await listWorlds(before, limit)) });
  } catch (error) {
    console.error("[worlds] list failed", (error as Error)?.name);
    return NextResponse.json({ success: false, worlds: [], next: null }, { status: 500 });
  }
}

const publishSchema = z.object({
  revealId: z.string().uuid(),
  revealToken: z.string().min(16).max(128),
  includeReading: z.boolean(),
});

/** POST /api/worlds — publish the caller's own reveal (requires its private reveal token). */
export async function POST(request: Request) {
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });

  const stored = await loadReveal(parsed.data.revealId, parsed.data.revealToken);
  if (!stored) return NextResponse.json({ success: false, error: "reveal_unavailable" }, { status: 404 });
  if (parsed.data.includeReading) {
    const found = findPersonalInfo(stored.reveal.personality_reading);
    if (found.length) {
      return NextResponse.json({ success: false, error: "personal_info", kinds: found }, { status: 422 });
    }
  }
  const existingId = await publishedIdForReveal(parsed.data.revealId);
  if (existingId) return NextResponse.json({ success: false, error: "already_published", id: existingId }, { status: 409 });
  // Only requests that would really publish count; rejected or retried ones must not burn the quota.
  const limit = await rateLimit("publish-world", clientKey(request), 10, 86_400);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const result = await publishWorld(parsed.data.revealId, buildSnapshot(stored, parsed.data.includeReading));
  if ("existingId" in result) {
    return NextResponse.json({ success: false, error: "already_published", id: result.existingId }, { status: 409 });
  }
  countMetric("worlds:published");
  return NextResponse.json({ success: true, world: summarize(result.world), ownerToken: result.ownerToken });
}
