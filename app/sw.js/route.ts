import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * This worker deliberately owns no cache. Its source changes with every
 * deployment, which lets the browser install it immediately, claim active
 * clients, and lets PwaUpdater reload into a client bundle that matches the
 * API routes from that same deployment.
 */
export async function GET() {
  const deploymentId =
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_URL ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "local";
  const source = `
const deploymentId = ${JSON.stringify(deploymentId)};
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
`;

  return new NextResponse(source, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    },
  });
}