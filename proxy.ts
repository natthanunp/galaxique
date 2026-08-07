import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Same-origin guard for all /api/* routes.
 *
 * The browser automatically sends an `Origin` header on every same-origin
 * fetch() call. External scripts (curl, Postman, Python bots, etc.) either
 * omit the header entirely or send a different origin. We reject anything
 * that doesn't match our own host so only the app's own frontend can call
 * the server-side APIs.
 *
 * This is intentionally lightweight — no auth, no tokens, no Redis. It
 * raises the bar from "anyone can script-hit our paid LLM endpoints" to
 * "you must at least be running in a browser tab on our own origin."
 * A determined attacker could spoof the Origin header, so this is a
 * first line of defense, not a complete security solution.
 */

/** Dev origins that are allowed in addition to the request's own host.
 *  Matches the `allowedDevOrigins` in next.config.ts — LAN IPs used for
 *  mobile testing on the same Wi-Fi. */
const DEV_ORIGINS = new Set([
  "http://192.168.1.38:3000",
  "http://192.168.1.33:3000",
]);

/** Returns the request's own origin (protocol + host), e.g.
 *  "http://localhost:3000" in dev or "https://galaxique.app" in prod. */
function selfOrigin(request: NextRequest): string {
  return `${request.nextUrl.protocol}//${request.nextUrl.host}`;
}

/** Browsers send `Origin` on POST/PUT/DELETE and cross-origin requests,
 *  but NOT on same-origin GET fetches. The `Referer` header, however, is
 *  sent on all same-origin fetches regardless of method. We check both
 *  so GET endpoints like /api/stats and /api/spotify/search aren't
 *  accidentally blocked. */
function isAllowed(request: NextRequest): boolean {
  const self = selfOrigin(request);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Origin header — present on POST/cross-origin, matches our host?
  if (origin === self) return true;
  if (origin && DEV_ORIGINS.has(origin)) return true;

  // Referer header — present on same-origin GETs, starts with our origin?
  if (referer) {
    if (referer.startsWith(self + "/") || referer === self) return true;
    for (const dev of DEV_ORIGINS) {
      if (referer.startsWith(dev + "/") || referer === dev) return true;
    }
  }

  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only guard API routes — static assets, pages, etc. are public.
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!isAllowed(request)) {
    return NextResponse.json(
      { error: "Forbidden: requests must originate from the app." },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Run on all API routes. Non-API routes pass through immediately (see
  // the early return above), so the cost is a single pathname check.
  matcher: "/api/:path*",
};
