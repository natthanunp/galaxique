import { Effect } from "postprocessing";
import { Uniform, Vector2 } from "three";

const fragmentShader = /* glsl */ `
  uniform vec2 center;
  uniform float strength;
  uniform float radius;

  void mainUv(inout vec2 uv) {
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
 */
export class LensingEffect extends Effect {
  constructor({ strength = 1, radius = 0.42 }: LensingEffectOptions = {}) {
    super("LensingEffect", fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["center", new Uniform(new Vector2(0.5, 0.5))],
        ["strength", new Uniform(strength)],
        ["radius", new Uniform(radius)],
      ]),
    });
  }

  setCenter(center: Vector2) {
    (this.uniforms.get("center")?.value as Vector2).copy(center);
  }

  setStrength(strength: number) {
    this.uniforms.get("strength")?.value = strength;
  }

  setRadius(radius: number) {
    this.uniforms.get("radius")?.value = radius;
  }
}
