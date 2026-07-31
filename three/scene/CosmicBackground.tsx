"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { tierParticleMultiplier } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";
import type { Vibe } from "@/types/universe";

interface CosmicBackgroundProps {
  primaryColor: string;
  secondaryColor: string;
  vibe: Vibe;
}

/** Vibe-driven nebula character parameters. Controls noise frequency,
 *  intensity, and smoothness to make each vibe feel distinct in the
 *  background itself. */
const VIBE_NEBULA_PARAMS: Record<Vibe, { scale: number; intensity: number; smoothness: number }> = {
  cute: { scale: 1.8, intensity: 0.45, smoothness: 0.6 },
  cozy: { scale: 2.2, intensity: 0.4, smoothness: 0.5 },
  mysterious: { scale: 3.2, intensity: 0.5, smoothness: 0.3 },
  intense: { scale: 3.8, intensity: 0.6, smoothness: 0.2 },
  whimsical: { scale: 2.8, intensity: 0.5, smoothness: 0.4 },
  cynical: { scale: 1.6, intensity: 0.25, smoothness: 0.7 },
};

/**
 * A single procedural shader-based skybox sphere: a giant inward-facing
 * sphere (radius 400 — far outside the ~4-16 unit orbit-control range, so
 * parallax from camera movement is negligible) whose fragment shader paints
 * both a slowly-drifting fbm noise nebula and a hash-based "baked" starfield
 * in one pass. This replaces the previous ~9 separate particle/point-cloud/
 * sprite draw calls (distant stars + mid stars + nebula quads) with a single
 * draw call and a single material.
 *
 * Nebula noise octaves and star density scale with the live adaptive quality
 * tier (usePerfStore) so Firefox/Edge/low-power devices automatically get a
 * cheaper shader (fewer fbm octaves, slightly sparser stars).
 */
export function CosmicBackground({
  primaryColor,
  secondaryColor,
  vibe,
}: CosmicBackgroundProps) {
  const tier = usePerfStore((s) => s.tier);
  const groupRef = useRef<THREE.Group>(null);

  const octaves = tier === "low" ? 2 : tier === "medium" ? 3 : 5;
  const starDensity = 0.6 + tierParticleMultiplier(tier) * 0.4;
  const nebulaParams = VIBE_NEBULA_PARAMS[vibe];

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(primaryColor) },
        uColorB: { value: new THREE.Color(secondaryColor) },
        uOctaves: { value: octaves },
        uStarDensity: { value: starDensity },
        uNebulaScale: { value: nebulaParams.scale },
        uNebulaIntensity: { value: nebulaParams.intensity },
        uNebulaSmoothness: { value: nebulaParams.smoothness },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform int uOctaves;
        uniform float uStarDensity;
        uniform float uNebulaScale;
        uniform float uNebulaIntensity;
        uniform float uNebulaSmoothness;

        float hash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        float valueNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(
              mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
              mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
              f.y
            ),
            mix(
              mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
              mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
              f.y
            ),
            f.z
          );
        }

        float fbm(vec3 p) {
          float value = 0.0;
          float amp = 0.5;
          vec3 pp = p;
          for (int i = 0; i < 5; i++) {
            if (i >= uOctaves) break;
            value += amp * valueNoise(pp);
            pp *= 2.02;
            amp *= 0.5;
          }
          return value;
        }

        void main() {
          vec3 dir = normalize(vDir);

          // --- Nebula: slow-drifting fbm noise, tinted between the two
          // reveal colors, desaturated so it stays a soft backdrop.
          // Vibe-driven scale/intensity/smoothness control the character. ---
          float n = fbm(dir * uNebulaScale + vec3(0.0, 0.0, uTime * 0.012));
          float smoothRange = uNebulaSmoothness;
          n = smoothstep(0.5 - smoothRange, 0.5 + smoothRange, n);
          vec3 nebula = mix(uColorA, uColorB, fract(n * 1.6)) * n * uNebulaIntensity;

          // --- Stars: hash-grid "baked" points on the direction sphere,
          // sharp thresholded flecks with a gentle per-star twinkle. Capped
          // below the postprocessing Bloom threshold (see UniverseCanvas)
          // so the skybox itself doesn't wash the whole frame out — bloom
          // is reserved for the central object's emissive materials.
          vec3 grid = dir * 240.0;
          vec3 gi = floor(grid);
          float h = hash(gi);
          float thresh = 1.0 - 0.018 * uStarDensity;
          float starMask = step(thresh, h);
          float twinkle = 0.55 + 0.45 * sin(uTime * 1.6 + h * 6.2831);
          vec3 starColor = vec3(1.0, 0.96 - h * 0.15, 1.0 - h * 0.35) * starMask * twinkle * 0.55;

          gl_FragColor = vec4(nebula + starColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, [primaryColor, secondaryColor, octaves, starDensity, nebulaParams]);

  useFrame((state, delta) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uOctaves.value = octaves;
    material.uniforms.uStarDensity.value = starDensity;
    material.uniforms.uNebulaScale.value = nebulaParams.scale;
    material.uniforms.uNebulaIntensity.value = nebulaParams.intensity;
    material.uniforms.uNebulaSmoothness.value = nebulaParams.smoothness;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.006;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh material={material}>
        <sphereGeometry args={[400, 32, 20]} />
      </mesh>
    </group>
  );
}
