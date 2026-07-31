"use client";

import { useMemo } from "react";

import type { UniverseReveal, Vibe } from "@/types/universe";

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

/** Vibe-appropriate rotation speed ranges. Cynical/mysterious are slow and
 *  deliberate; cute/intense are lively and energetic. */
const VIBE_ROTATION_RANGES: Record<Vibe, [number, number]> = {
  cute: [0.4, 0.8],
  cozy: [0.3, 0.7],
  mysterious: [0.2, 0.5],
  intense: [1.0, 2.0],
  whimsical: [0.6, 1.4],
  cynical: [0.2, 0.5],
};

/** Vibe-appropriate particle density defaults. Cynical is sparse; cute/intense
 *  are abundant. */
const VIBE_DENSITY_DEFAULTS: Record<Vibe, UniverseReveal["particle_density"]> = {
  cute: "high",
  cozy: "medium",
  mysterious: "medium",
  intense: "high",
  whimsical: "high",
  cynical: "low",
};

/** Clamps a value to the given range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps the Gemini reveal JSON into a stable scene-config object, with
 *  vibe-driven adjustments to rotation speed and particle density. */
export function useUniverseConfig(
  reveal: UniverseReveal | null,
): UniverseSceneConfig | null {
  return useMemo(() => {
    if (!reveal) return null;

    // Clamp rotation speed to vibe-appropriate range
    const [minRot, maxRot] = VIBE_ROTATION_RANGES[reveal.vibe];
    const clampedRotation = clamp(reveal.rotation_speed, minRot, maxRot);

    // Override particle density if LLM chose something mismatched
    const defaultDensity = VIBE_DENSITY_DEFAULTS[reveal.vibe];
    const density = reveal.particle_density ?? defaultDensity;

    return {
      celestialType: reveal.celestial_type,
      centralSymbol: reveal.central_symbol,
      primaryColor: reveal.primary_color,
      secondaryColor: reveal.secondary_color,
      rotationSpeed: clampedRotation,
      particleDensity: density,
      vibe: reveal.vibe,
    };
  }, [reveal]);
}
