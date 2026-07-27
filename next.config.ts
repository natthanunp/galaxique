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
    ];
  },
};

export default nextConfig;
