"use client";

import dynamic from "next/dynamic";

/** Shared client-only 3D backdrop for pages and loading states. */
export const AnimatedUniverseBackground = dynamic(
  () => import("@/components/shared/HomepageUniverse"),
  { ssr: false },
);
