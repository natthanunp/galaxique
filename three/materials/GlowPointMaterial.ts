import * as THREE from "three";

import {
  glowParticleVertexShader,
  glowParticleFragmentShader,
} from "@/three/shaders/glowParticle.glsl";

/**
 * A soft, round, additive glowing-point material.
 *
 * Built directly on THREE.ShaderMaterial (rather than Drei's shaderMaterial
 * helper) for maximum compatibility. Each point can carry a `size` and `aSeed`
 * attribute; the fragment shader lerps between uColorA and uColorB per-particle
 * and fades to a soft circle.
 *
 * Usage: pass colors as hex strings; the material converts them to THREE.Color.
 * Set `transparent` + `depthWrite={false}` + `blending={AdditiveBlending}` on
 * the parent points for the correct glow look.
 */
export interface GlowPointMaterialParameters {
  colorA?: THREE.ColorRepresentation;
  colorB?: THREE.ColorRepresentation;
  size?: number;
  twinkle?: number;
  pixelRatio?: number;
}

export function createGlowPointMaterial({
  colorA = "#ffffff",
  colorB = "#ffffff",
  size = 8,
  twinkle = 0.15,
  pixelRatio = 1,
}: GlowPointMaterialParameters = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uSize: { value: size },
      uPixelRatio: { value: pixelRatio },
      uTwinkle: { value: twinkle },
    },
    vertexShader: glowParticleVertexShader,
    fragmentShader: glowParticleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
