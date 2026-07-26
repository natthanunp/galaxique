import { NextResponse } from "next/server";

import { getSpotifyToken, spotifyConfigured } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/token — returns a Client Credentials access token.
 *
 * Exposed for any client-side Spotify Web Playback needs. The client secret
 * itself is never returned; only the short-lived bearer token.
 */
export async function GET() {
  if (!spotifyConfigured()) {
    return NextResponse.json(
      { error: "Spotify credentials are not configured." },
      { status: 500 },
    );
  }
  try {
    const token = await getSpotifyToken();
    return NextResponse.json({ access_token: token });
  } catch (err) {
    console.error("[spotify/token]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to get Spotify token.", detail: message },
      { status: 502 },
    );
  }
}
