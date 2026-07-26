import { NextResponse } from "next/server";

import { getTrackById, searchTrack, spotifyConfigured } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/search?id=<trackId> or ?q=<query> — resolve a track.
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
  const trackId = searchParams.get("id")?.trim();
  const q = searchParams.get("q")?.trim();
  if (!trackId && !q) {
    return NextResponse.json(
      { error: "Missing 'id' or 'q' query parameter." },
      { status: 400 },
    );
  }

  try {
    const track = trackId ? await getTrackById(trackId) : await searchTrack(q!);
    if (!track) {
      return NextResponse.json(
        { error: trackId ? "Spotify track not found." : "No track found for that query." },
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
