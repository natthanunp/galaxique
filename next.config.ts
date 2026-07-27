import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack root to this workspace so the parent lockfile
  // (/Users/npuntanee/package-lock.json) doesn't trigger a root-inference warning.
  turbopack: {
    root: __dirname,
  },

  // Prevent mobile Safari from serving a stale HTML shell from HTTP cache
  // after a new deployment. The service worker intentionally owns no cache,
  // but Safari can still keep the document and its _next/static chunks in
  // its own cache / bfcache. These headers force revalidation on every visit
  // so the newest app bundle loads first.
  async headers() {
    return [
      {
        source: "/((?!api|_next|sw.js|assets|audio|public).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      // The multi-threaded ffmpeg core (@ffmpeg/core-mt) uses
      // SharedArrayBuffer inside its pthread worker. Browsers gate that
      // behind "cross-origin isolation", which requires these two headers
      // on the document and on every resource the worker fetches. We
      // scope them narrowly to /ffmpeg-mt/* so the rest of the app keeps
      // normal cross-origin embedding behavior (analytics, Spotify iframe,
      // etc.). The wrapper's module worker also runs on the page's
      // origin, so COEP here doesn't need to bleed into the rest of the
      // site — the worker fetches same-origin modules only.
      {
        source: "/ffmpeg-mt/:path*",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      // @ffmpeg/ffmpeg's wrapper worker lives here. Even though it is
      // same-origin, a module worker created by a COEP page must itself
      // carry compatible isolation headers; otherwise Firefox rejects it
      // as ERR_BLOCKED_BY_RESPONSE before it can import the mt core.
      {
        source: "/ffmpeg/:path*",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      // The mt core needs SharedArrayBuffer, which requires the document
      // itself to be cross-origin isolated. Album art and preview audio now
      // go through /api/media (same origin, strict host allowlist), so these
      // headers no longer block them as they did when they came directly
      // from Spotify/iTunes CDNs.
      {
        source: "/reveal",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
