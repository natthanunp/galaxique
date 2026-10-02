import { NextResponse } from "next/server";
import { z } from "zod";

import { countMetric } from "@/lib/metrics";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { reportWorld } from "@/lib/worldStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/worlds/{id}/report — hides the world pending review. */
export async function POST(request: Request, ctx: RouteContext<"/api/worlds/[id]/report">) {
  const { id } = await ctx.params;
  const body = z.object({ reason: z.enum(["personal_info", "offensive", "spam", "other"]) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  const limit = await rateLimit("report-ip", clientKey(request), 10, 86_400);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const ok = await reportWorld(id, body.data.reason);
  if (!ok) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  countMetric("worlds:reported");
  return NextResponse.json({ success: true });
}
