import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack root to this workspace so the parent lockfile
  // (/Users/npuntanee/package-lock.json) doesn't trigger a root-inference warning.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
