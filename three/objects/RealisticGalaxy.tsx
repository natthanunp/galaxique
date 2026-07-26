"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { isMobileDevice, tierParticleMultiplier } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";
import type { GalaxyVisualConfig } from "@/types/universe";

interface RealisticGalaxyProps {
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  particleDensity: "high" | "medium" | "low";
  config?: GalaxyVisualConfig;
  children?: ReactNode;
}

const DEFAULT_CONFIG: GalaxyVisualConfig = {
  seed: 184_038_221,
  morphology: "grand_design",
  arm_count: 4,
  arm_tightness: 1.1,
  bulge_strength: 0.6,
  disc_thickness: 0.16,
  dust_prominence: 0.45,
  stellar_temperature: "balanced",
};

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

function densityMultiplier(density: RealisticGalaxyProps["particleDensity"]): number {
  if (density === "high") return 1.25;
  if (density === "low") return 0.65;
  return 1;
}

function temperatureColor(
  random: () => number,
  core: THREE.Color,
  arm: THREE.Color,
  temperature: GalaxyVisualConfig["stellar_temperature"],
  radialProgress: number,
): THREE.Color {
  const white = new THREE.Color("#fff8e8");
  const cool = new THREE.Color("#a9c7ff");
  const warm = new THREE.Color("#ffd09c");
  const youngStarBias = temperature === "cool" ? 0.7 : temperature === "warm" ? 0.2 : 0.45;
  const population = random();
  const base = population < youngStarBias
    ? arm.clone().lerp(cool, 0.34)
    : arm.clone().lerp(warm, 0.28);
  return base.lerp(core, Math.max(0, 0.7 - radialProgress) * 0.72).lerp(white, random() * 0.16);
}

/**
 * A seeded stellar disc that reads as an astronomical galaxy instead of a
 * sculpted ribbon. The LLM supplies a bounded morphology; all particle data is
 * generated once per blueprint/tier and only the parent group animates.
 */
export function RealisticGalaxy({
  primaryColor,
  secondaryColor,
  rotationSpeed,
  particleDensity,
  config = DEFAULT_CONFIG,
  children,
}: RealisticGalaxyProps) {
  const tier = usePerfStore((state) => state.tier);
  const mobile = isMobileDevice();
  const { gl } = useThree();
  const discRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const starCount = Math.max(
    900,
    Math.round(
      (mobile ? 2_400 : 6_200) *
        densityMultiplier(particleDensity) *
        tierParticleMultiplier(tier),
    ),
  );

  const { geometry, material, coreMaterial, discMaterial } = useMemo(() => {
    const random = seededRandom(config.seed);
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const sparkle = new Float32Array(starCount);
    const core = new THREE.Color(primaryColor).lerp(new THREE.Color("#fff1d6"), 0.3);
    const arm = new THREE.Color(secondaryColor);
    const maxRadius = 4.2;
    const armShare = config.morphology === "flocculent" ? 0.32 : config.morphology === "ringed" ? 0.28 : 0.38;
    const bulgeShare = 0.1 + config.bulge_strength * 0.16;

    for (let index = 0; index < starCount; index++) {
      const sample = random();
      let radius: number;
      let angle: number;
      let thickness: number;

      if (sample < bulgeShare) {
        radius = Math.pow(random(), 1.8) * (0.75 + config.bulge_strength * 0.95);
        angle = random() * Math.PI * 2;
        thickness = (1 - radius / 2) * (0.14 + config.disc_thickness * 0.52);
      } else if (config.morphology === "ringed" && sample < bulgeShare + 0.3) {
        radius = 2.45 + (random() - 0.5) * 0.5;
        angle = random() * Math.PI * 2;
        thickness = config.disc_thickness * 0.42;
      } else if (config.morphology === "barred" && sample < bulgeShare + 0.2) {
        radius = random() * 1.85;
        angle = random() > 0.5 ? 0 : Math.PI;
        angle += (random() - 0.5) * 0.24;
        thickness = config.disc_thickness * 0.36;
      } else if (sample < bulgeShare + armShare) {
        radius = 0.45 + Math.pow(random(), 0.68) * (maxRadius - 0.45);
        const armIndex = Math.floor(random() * config.arm_count);
        const armBase = (armIndex / config.arm_count) * Math.PI * 2;
        const scatter = config.morphology === "flocculent" ? 0.82 : 0.34 + radius * 0.06;
        angle = armBase + radius * config.arm_tightness + (random() - 0.5) * scatter;
        radius += (random() - 0.5) * (0.12 + radius * 0.08);
        thickness = config.disc_thickness * (0.18 + random() * 0.45);
      } else {
        radius = 0.35 + Math.pow(random(), 0.58) * (maxRadius - 0.35);
        angle = random() * Math.PI * 2;
        thickness = config.disc_thickness * (0.1 + random() * 0.36);
      }

      const radialProgress = Math.min(1, radius / maxRadius);
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle) * radius;
      positions[index * 3 + 2] = (random() - 0.5) * thickness;

      const color = temperatureColor(random, core, arm, config.stellar_temperature, radialProgress);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 0.28 + random() * (radius < 1.2 ? 1.1 : 0.62);
      sparkle[index] = random();
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    nextGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    nextGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    nextGeometry.setAttribute("aSparkle", new THREE.BufferAttribute(sparkle, 1));
    nextGeometry.computeBoundingSphere();

    const nextMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 1.5) },
        uMotion: { value: tier === "high" ? 0.08 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSparkle;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uMotion;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vec4 modelPosition = modelViewMatrix * vec4(position, 1.0);
          float twinkle = 1.0 + sin(uTime * 1.15 + aSparkle * 6.2831) * uMotion;
          gl_PointSize = clamp(aSize * uPixelRatio * twinkle * (28.0 / max(2.0, -modelPosition.z)), 1.0, 7.0);
          vAlpha = 0.2 + aSize * 0.14;
          gl_Position = projectionMatrix * modelPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 point = gl_PointCoord - vec2(0.5);
          float distanceToCenter = length(point);
          if (distanceToCenter > 0.5) discard;
          float softness = smoothstep(0.5, 0.08, distanceToCenter);
          gl_FragColor = vec4(vColor * (0.65 + softness * 0.65), softness * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    return {
      geometry: nextGeometry,
      material: nextMaterial,
      coreMaterial: new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 0.28 }),
      discMaterial: new THREE.MeshBasicMaterial({
        color: arm.clone().multiplyScalar(0.42),
        transparent: true,
        opacity: 0.025 + config.dust_prominence * 0.035,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    };
  }, [config, gl, primaryColor, secondaryColor, starCount, tier]);

  useFrame((state, delta) => {
    if (discRef.current) {
      discRef.current.rotation.z += delta * rotationSpeed * 0.1;
    }
    if (materialRef.current) materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      <group ref={discRef}>
        <mesh material={discMaterial}>
          <circleGeometry args={[4.35, 64]} />
        </mesh>
        <points geometry={geometry} material={material} ref={(points) => {
          materialRef.current = points?.material as THREE.ShaderMaterial | null;
        }} />
        <mesh material={coreMaterial}>
          <sphereGeometry args={[0.32 + config.bulge_strength * 0.36, 20, 16]} />
        </mesh>
      </group>
      {children}
    </group>
  );
}