import { NextResponse } from "next/server";

import { getWorld, ownedWorldIds, ownerTokenFrom, summarize } from "@/lib/worldStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/worlds/mine — worlds owned by the bearer token (including unpublished). */
export async function GET(request: Request) {
  const token = ownerTokenFrom(request);
  if (!token) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  const ids = await ownedWorldIds(token);
  const worlds = (await Promise.all(ids.map(getWorld))).flatMap((w) => (w ? [summarize(w)] : []));
  return NextResponse.json({ success: true, ids, worlds });
}
