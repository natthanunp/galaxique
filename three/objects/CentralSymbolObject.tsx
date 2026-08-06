"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { getConstellationPoints } from "@/three/constellations";
import { createGlowPointMaterial } from "@/three/materials/GlowPointMaterial";
import type { CentralSymbol } from "@/types/universe";

interface CentralSymbolObjectProps {
  symbol: CentralSymbol;
  primaryColor: string;
  secondaryColor: string;
  /** Overall scale of the central shape. */
  scale?: number;
}

/**
 * Renders the central "soul" shape (currently "star" or "heart") as a glowing
 * particle constellation that sits inside the larger cosmic object.
 *
 * Points come from the hardcoded registry (Float32Array outlines). Each point
 * gets a per-particle `size` and `aSeed` attribute so the glow shader can
 * twinkle and color-variegate them. The whole shape slowly rotates and bobs.
 *
 * "none" returns null so callers (UniverseScene) can simply skip rendering
 * the overlay when the cosmic object is meant to shine on its own (e.g. a
 * black hole or a neutron star).
 */
export function CentralSymbolObject({
  symbol,
  primaryColor,
  secondaryColor,
  scale = 2.4,
}: CentralSymbolObjectProps) {
  const points = useMemo(() => getConstellationPoints(symbol), [symbol]);
  const groupRef = useRef<THREE.Group>(null);
  const { gl, size } = useThree();
  const isNarrow = size.width < 640;

  // Build geometry attributes from the outline points.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (!points) return geo;

    const count = points.length / 3;
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      sizes[i] = isNarrow
        ? 2 + Math.random() * 3
        : 2.4 + Math.random() * 2.6;
      seeds[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return geo;
  }, [isNarrow, points]);

  // Create the glow material once (colors update via uniform mutation below).
  const material = useMemo(() => {
    const nextMaterial = createGlowPointMaterial({
        colorA: primaryColor,
        colorB: secondaryColor,
        size: 8,
        twinkle: 0.18,
        pixelRatio: Math.min(gl.getPixelRatio(), 2),
      });
    nextMaterial.depthTest = false;
    return nextMaterial;
    // Recreate only when colors change; uniforms are stable refs.
  }, [primaryColor, secondaryColor, gl]);

  // Keep a ref to the material for per-frame uniform updates.
  const matRef = useRef<THREE.ShaderMaterial>(material);

  useFrame((state) => {
    if (groupRef.current) {
      // Gentle bob.
      groupRef.current.position.y =
        Math.sin(state.clock.elapsedTime * 0.5) * 0.05;
    }
    matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  if (!points) return null;

  return (
    <group ref={groupRef} scale={scale}>
      <points geometry={geometry} material={material} renderOrder={2} />
    </group>
  );
}
