"use client";

import dynamic from "next/dynamic";

import type { WorldSnapshot } from "@/lib/worldStore";

// WebGL scene is client-only.
const PlanetLanding = dynamic(() => import("@/components/landing/PlanetLanding").then((m) => m.PlanetLanding), { ssr: false });

export function PlanetLandingClient(props: { worldId: string; world: WorldSnapshot | null }) {
  return <PlanetLanding {...props} />;
}
