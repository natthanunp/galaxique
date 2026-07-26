import { NextResponse } from "next/server";

import { searchTrack, spotifyConfigured } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/search?q=<query> — resolve a vibe-matched query to a track.
 *
 * Returns { track_id, name, artist, embed_url } or 404 if nothing found.
 */
export async function GET(request: Request) {
  if (!spotifyConfigured()) {
    return NextResponse.json(
      { error: "Spotify credentials are not configured." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: "Missing 'q' query parameter." },
      { status: 400 },
    );
  }

  try {
    const track = await searchTrack(q);
    if (!track) {
      return NextResponse.json(
        { error: "No track found for that query." },
        { status: 404 },
      );
    }
    return NextResponse.json(track);
  } catch (err) {
    console.error("[spotify/search]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Spotify search failed.", detail: message },
      { status: 502 },
    );
  }
}
