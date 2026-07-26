"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { createGlowPointMaterial } from "@/three/materials/GlowPointMaterial";
import { densityToCount } from "@/three/utils/colors";
import { isMobileDevice, tierParticleMultiplier } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";

interface ParticleFieldProps {
  primaryColor: string;
  secondaryColor: string;
  density: "high" | "medium" | "low";
  seed?: number;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A spherical shell of ambient dust particles surrounding the central object.
 * Density is driven by the API's `particle_density` (high = rich inner world)
 * and further scaled by the live adaptive quality tier (now lower baseline
 * since CosmicBackground's skybox supplies most of the base star density).
 * Particles drift slowly and twinkle via the shared glow shader.
 */
export function ParticleField({
  primaryColor,
  secondaryColor,
  density,
  seed = 48_218_907,
}: ParticleFieldProps) {
  const tier = usePerfStore((s) => s.tier);
  const base = isMobileDevice() ? 160 : 260;
  const count = Math.max(40, Math.round(densityToCount(density, base) * tierParticleMultiplier(tier)));
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const { geometry, material } = useMemo(() => {
    const random = seededRandom(seed);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const r = 5.5 + random() * 3.5;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = 0.28 + random() * 0.57;
      seeds[i] = random();
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const mat = createGlowPointMaterial({
      colorA: primaryColor,
      colorB: secondaryColor,
      size: 4,
      twinkle: 0.25,
      pixelRatio: Math.min(gl.getPixelRatio(), 2),
    });
    return { geometry: geo, material: mat };
  }, [count, primaryColor, secondaryColor, gl, seed]);

  useFrame((state, delta) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.03;
    }
    const material = pointsRef.current?.material;
    if (material instanceof THREE.ShaderMaterial) {
      material.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
