import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getSpotifyAuthorizationUrl } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "spotify_oauth_state";

/** Starts one-time Spotify owner authorization for the configured playlist. */
export async function GET() {
  try {
    const state = randomUUID();
    const response = NextResponse.redirect(getSpotifyAuthorizationUrl(state));
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.SPOTIFY_REDIRECT_URI?.startsWith("https://") ?? false,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Could not start Spotify authorization.", detail: message },
      { status: 500 },
    );
  }
}