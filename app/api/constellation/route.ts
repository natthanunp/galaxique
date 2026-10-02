import { NextResponse } from "next/server";
import { getLegacyStars } from "@/lib/constellationStore";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/constellation
 * Legacy summaries were never published with consent, so only decorative
 * data leaves the server: no IDs, text, creature names, or songs.
 * There is intentionally no POST; publishing will require explicit opt-in.
 */
export async function GET() {
  try {
    const stars = await getLegacyStars();
    return NextResponse.json({ success: true, stars, count: stars.length });
  } catch (error) {
    console.error("[constellation] GET error:", (error as Error)?.name);
    return NextResponse.json({ success: false, stars: [], count: 0 }, { status: 500 });
  }
}
