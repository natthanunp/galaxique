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
      // COEP require-corp considers a response "same-origin" loaded only
      // if it carries a Cross-Origin-Resource-Policy header that says so.
      // Without that header, Chrome silently demotes the document from
      // cross-origin isolated to not-isolated, and @ffmpeg/core-mt throws
      // "Can't find variable: SharedArrayBuffer" inside its worker — even
      // though the document itself has the right COOP/COEP. Tag every
      // same-origin asset path we ship so the page actually isolates in
      // production. The mt core is path-scoped separately below because it
      // also needs the COOP pair (some browsers refuse to honour COEP for a
      // resource served without COOP on the resource itself).
      {
        source: "/_next/:path*",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/assets/:path*",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/audio/:path*",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/galaxique-192-v2.png",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/galaxique-512-v2.png",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/icon",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/apple-icon",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/favicon.ico",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      // The multi-threaded core creates pthread workers backed by
      // SharedArrayBuffer. Its JavaScript, wasm, and worker files must
      // carry the same isolation policy as the /reveal document.
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
      // /api/media proxies third-party images and audio. The route sets
      // Cross-Origin-Resource-Policy on its responses, so isolation stays
      // intact when /reveal loads them under COEP require-corp.
      {
        source: "/api/media/:path*",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
