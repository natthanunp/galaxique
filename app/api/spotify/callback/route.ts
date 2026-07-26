import { NextRequest, NextResponse } from "next/server";

import { exchangeSpotifyAuthorizationCode } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "spotify_oauth_state";

/** Exchanges Spotify's one-time code and returns the owner's refresh token once. */
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const authError = request.nextUrl.searchParams.get("error");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const response = (body: Record<string, string>, status = 200) => {
    const result = NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
    result.cookies.delete(STATE_COOKIE);
    return result;
  };

  if (authError) {
    return response({ error: `Spotify authorization was denied: ${authError}` }, 400);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return response({ error: "Invalid or expired Spotify authorization state." }, 400);
  }

  try {
    const refreshToken = await exchangeSpotifyAuthorizationCode(code);
    return response({
      message:
        "Set this value as SPOTIFY_REFRESH_TOKEN in .env.local and Vercel Production, then keep it secret.",
      refresh_token: refreshToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return response(
      { error: "Could not finish Spotify authorization.", detail: message },
      502,
    );
  }
}