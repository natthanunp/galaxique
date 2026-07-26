"use client";

import { useMemo } from "react";

import type { UniverseReveal } from "@/types/universe";

/** Scene-facing props derived from the reveal JSON. Kept as a thin adapter so
 *  the 3D layer never touches the raw API shape directly. */
export interface UniverseSceneConfig {
  celestialType: UniverseReveal["celestial_type"];
  centralSymbol: UniverseReveal["central_symbol"];
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  particleDensity: UniverseReveal["particle_density"];
  vibe: UniverseReveal["vibe"];
}

/** Maps the Gemini reveal JSON into a stable scene-config object. */
export function useUniverseConfig(
  reveal: UniverseReveal | null,
): UniverseSceneConfig | null {
  return useMemo(() => {
    if (!reveal) return null;
    return {
      celestialType: reveal.celestial_type,
      centralSymbol: reveal.central_symbol,
      primaryColor: reveal.primary_color,
      secondaryColor: reveal.secondary_color,
      rotationSpeed: reveal.rotation_speed,
      particleDensity: reveal.particle_density,
      vibe: reveal.vibe,
    };
  }, [reveal]);
}
