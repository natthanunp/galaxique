import { Effect } from "postprocessing";
import { Uniform } from "three";

const fragmentShader = /* glsl */ `
  uniform float strength;
  uniform float radius;

  void mainUv(inout vec2 uv) {
    vec2 center = vec2(0.5);
    vec2 delta = uv - center;
    float dist = length(delta);
    float falloff = smoothstep(radius, 0.0, dist);
    vec2 dir = dist > 0.0001 ? delta / dist : vec2(0.0);
    // Radial pull toward the center, strongest near the horizon and fading
    // out smoothly — a cheap stand-in for true ray-marched gravitational
    // lensing that only warps UVs (no extra scene passes needed).
    float warp = falloff * falloff * strength * 0.14;
    uv -= dir * warp;
  }
`;

export interface LensingEffectOptions {
  strength?: number;
  radius?: number;
}

/**
 * Screen-space radial UV warp around the projected black hole position.
 *
 * The black hole is always rendered at the scene origin and OrbitControls
 * orbits the camera around that same origin (see UniverseCanvas), so its
 * projected screen position stays effectively centered regardless of camera
 * angle — this lets the effect use a fixed screen-space center instead of
 * computing a per-frame world-to-screen projection.
 */
export class LensingEffect extends Effect {
  constructor({ strength = 1, radius = 0.42 }: LensingEffectOptions = {}) {
    super("LensingEffect", fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["strength", new Uniform(strength)],
        ["radius", new Uniform(radius)],
      ]),
    });
  }
}
