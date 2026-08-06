"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { isMobileDevice, tierParticleMultiplier } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";

interface GalaxyProps {
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  particleDensity: "high" | "medium" | "low";
  /** Optional overlay (e.g. a heart / star symbol) rendered at the core. */
  children?: ReactNode;
}

const ARM_STARS = { high: 2600, medium: 1900, low: 1200 };
const ARM_COUNT = 3;

/**
 * A diffuse spiral galaxy.
 *
 * Thousands of softly glowing stars follow broad, irregular spiral arms above
 * a faint galactic disk. This keeps the core visually present behind the vinyl
 * while avoiding the opaque, painted-ribbon look of solid tube meshes.
 */
export function Galaxy({
  primaryColor,
  secondaryColor,
  rotationSpeed,
  particleDensity,
  children,
}: GalaxyProps) {
  const mobile = isMobileDevice();
  const tier = usePerfStore((s) => s.tier);
  const groupRef = useRef<THREE.Group>(null);
  const visualGroupRef = useRef<THREE.Group>(null);
  const armGroupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const cA = useMemo(() => new THREE.Color(primaryColor), [primaryColor]);
  const cB = useMemo(() => new THREE.Color(secondaryColor), [secondaryColor]);
  const cHot = useMemo(() => cA.clone().lerp(new THREE.Color("#ffffff"), 0.35), [cA]);
  const cDust = useMemo(() => cB.clone().lerp(new THREE.Color("#000000"), 0.55), [cB]);

  const coreMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cHot,
        emissive: cA,
        emissiveIntensity: 0.6,
        roughness: 0.6,
        metalness: 0.1,
        flatShading: true,
      }),
    [cA, cHot],
  );

  const diskMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cDust,
        emissive: cA,
        emissiveIntensity: 0.08,
        roughness: 0.85,
        metalness: 0.0,
        transparent: true,
        opacity: 0.12,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    [cA, cDust],
  );

  // --- Diffuse stellar spiral arms. ---
  const armGeometry = useMemo(() => {
    const count = Math.max(
      500,
      Math.floor(ARM_STARS[particleDensity] * (mobile ? 0.55 : 1) * tierParticleMultiplier(tier)),
    );
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let index = 0; index < count; index++) {
      const arm = index % ARM_COUNT;
      const radiusProgress = Math.pow(Math.random(), 0.72);
      const radius = 0.16 + radiusProgress * 3.95;
      const armAngle = (arm / ARM_COUNT) * Math.PI * 2 + radius * 1.35;
      const lateralSpread = 0.035 + radiusProgress * 0.22;
      const lateral = (Math.random() + Math.random() + Math.random() - 1.5) * lateralSpread;
      const angle = armAngle + lateral;

      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (Math.random() - 0.5) * (0.04 + radiusProgress * 0.12);
      positions[index * 3 + 2] = Math.sin(angle) * radius;

      const color = cHot.clone().lerp(cB, Math.min(1, radiusProgress * 1.15));
      const brightness = 0.72 + Math.random() * 0.5;
      colors[index * 3] = Math.min(1, color.r * brightness);
      colors[index * 3 + 1] = Math.min(1, color.g * brightness);
      colors[index * 3 + 2] = Math.min(1, color.b * brightness);
      sizes[index] = 0.45 + Math.random() * 1.25;
      seeds[index] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return geometry;
  }, [cB, cHot, mobile, particleDensity, tier]);

  // --- Sparse sparkle particles on the arms. ---
  const sparkleGeometry = useMemo(() => {
    const count = Math.max(
      8,
      Math.floor(
        90 * (mobile ? 0.5 : 1) * (particleDensity === "low" ? 0.6 : 1) * tierParticleMultiplier(tier),
      ),
    );
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const arm = i % ARM_COUNT;
      const t = Math.pow(Math.random(), 0.9);
      const r = 0.7 + t * 3.0;
      const angle = (arm / ARM_COUNT) * Math.PI * 2 + r * 1.1;
      const lateral = (Math.random() - 0.5) * 0.3;
      const x = Math.cos(angle) * r + Math.cos(angle + Math.PI / 2) * lateral;
      const z = Math.sin(angle) * r + Math.sin(angle + Math.PI / 2) * lateral;
      const y = (Math.random() - 0.5) * 0.18;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      sizes[i] = 1.0 + Math.random() * 1.6;
      seeds[i] = Math.random();

      const col = Math.random() > 0.6 ? cHot : cB;
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return geo;
  }, [cB, cHot, mobile, particleDensity, tier]);

  const sparkleMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 0.2 } },
        vertexShader: /* glsl */ `
          attribute float size;
          attribute float aSeed;
          attribute vec3 aColor;
          uniform float uTime;
          uniform float uPixelRatio;
          uniform float uTwinkle;
          varying vec3 vColor;
          void main() {
            vColor = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float tw = 1.0 + sin(uTime * 2.0 + aSeed * 6.2831) * uTwinkle;
            float safeDepth = max(4.0, -mv.z);
            gl_PointSize = size * uPixelRatio * tw * (48.0 / safeDepth);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float d = length(uv);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.0, d);
            a = pow(a, 1.6);
            gl_FragColor = vec4(vColor * 1.4, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((state, delta) => {
    if (armGroupRef.current) {
      armGroupRef.current.rotation.y += delta * rotationSpeed * 0.12;
    }
    if (groupRef.current) {
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.04;
    }
    if (visualGroupRef.current) {
      // The arms are modeled in the XZ plane. Match the camera's orientation
      // so OrbitControls never turns their spiral into an edge-on stripe.
      visualGroupRef.current.quaternion.copy(camera.quaternion);
      visualGroupRef.current.rotateX(Math.PI / 2.6);
    }
    sparkleMaterial.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group ref={groupRef}>
      {/* The procedural arms are authored in the horizontal XZ plane. Tilt
          their assembly toward the +Z reveal camera so it reads as a spiral,
          while keeping the optional heart/star constellation upright. */}
      <group ref={visualGroupRef}>
        {/* Faint galactic disk. */}
        <mesh material={diskMaterial} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 4.0, 64]} />
        </mesh>

        {/* Diffuse stellar arms remain legible around the smaller vinyl. */}
        <group ref={armGroupRef}>
          <points geometry={armGeometry} material={sparkleMaterial} />
        </group>

        {/* Bright faceted core. */}
        <mesh material={coreMaterial}>
          <icosahedronGeometry args={[0.62, 1]} />
        </mesh>

        {/* Sparse arm sparkles. */}
        <points geometry={sparkleGeometry} material={sparkleMaterial} />
      </group>

      {/* Optional central "soul" symbol overlay. */}
      {children}
    </group>
  );
}
