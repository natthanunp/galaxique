import * as THREE from "three";

/** Parse a hex string like "#FFB4A2" into a THREE.Color (tolerant of # prefix). */
export function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex.startsWith("#") ? hex : `#${hex}`);
}

/** Lerp between two hex colors, returning a THREE.Color. */
export function lerpHex(a: string, b: string, t: number): THREE.Color {
  return hexToColor(a).lerp(hexToColor(b), t);
}

/** Map a particle_density string to an approximate particle count. */
export function densityToCount(
  density: "high" | "medium" | "low",
  base = 1200,
): number {
  switch (density) {
    case "high":
      return Math.round(base * 1.6);
    case "medium":
      return base;
    case "low":
      return Math.round(base * 0.5);
    default:
      return base;
  }
}
