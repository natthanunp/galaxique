import { NextResponse } from "next/server";
import { addStar, getStars, type ConstellationStar } from "@/lib/constellationStore";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/constellation
 * Returns all stars in the shared constellation sky.
 */
export async function GET() {
  try {
    const stars = await getStars();
    return NextResponse.json({ success: true, stars, count: stars.length });
  } catch (error) {
    console.error("[constellation] GET error:", error);
    return NextResponse.json({ success: false, stars: [], count: 0 }, { status: 500 });
  }
}

/**
 * POST /api/constellation
 * Stores a new universe star in the constellation.
 * Called internally after a successful analyze/reveal.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ConstellationStar>;
    if (!body.vibe || !body.primaryColor) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }
    const star: ConstellationStar = {
      id: (body.id ?? crypto.randomUUID?.().slice(0, 8) ?? `${Date.now().toString(36)}`),
      vibe: body.vibe,
      celestialType: body.celestialType ?? "galaxy",
      creatureKind: body.creatureKind ?? "spirit",
      creatureName: body.creatureName ?? "Companion",
      primaryColor: body.primaryColor,
      secondaryColor: body.secondaryColor ?? body.primaryColor,
      readingSnippet: (body.readingSnippet ?? "").slice(0, 200),
      songName: body.songName ?? "",
      songArtist: body.songArtist ?? "",
      createdAt: body.createdAt ?? Date.now(),
    };
    await addStar(star);
    return NextResponse.json({ success: true, star });
  } catch (error) {
    console.error("[constellation] POST error:", error);
    return NextResponse.json({ success: false, error: "Failed to store star" }, { status: 500 });
  }
}
