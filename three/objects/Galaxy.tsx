"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { isMobileDevice, tierParticleMultiplier } from "@/lib/perf";
import { COSMIC } from "@/lib/cosmicVisuals";
import { useBakedTexture } from "@/three/hooks/useBakedTexture";
import { usePerfStore } from "@/store/perfStore";

interface GalaxyProps {
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  particleDensity: "high" | "medium" | "low";
  /** Optional overlay (e.g. a heart / star symbol) rendered at the core. */
  children?: ReactNode;
}

const ARM_STARS = { high: 4500, medium: 3200, low: 2000 };
const ARM_COUNT = 3;
function seededRandom(seed: number) {
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
}

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
  const pointsRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const emission = useBakedTexture(COSMIC.textureUrl("stellar-emission", tier));
  const dust = useBakedTexture(COSMIC.textureUrl("dust-absorption", tier), 0, false);

  const cA = useMemo(() => new THREE.Color(primaryColor), [primaryColor]);
  const cB = useMemo(() => new THREE.Color(secondaryColor), [secondaryColor]);
  const cHot = useMemo(() => new THREE.Color(COSMIC.core).lerp(cA, 0.12), [cA]);

  const coreMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cHot,
        emissive: cHot,
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.2,
        flatShading: false,
      }),
    [cHot],
  );

  // Glow aura around the core — a tiny, soft halo that adds a subtle
  // luminous feel without overwhelming the scene.
  const coreGlowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: cA,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [cA],
  );

  const diskMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uEmission: { value: emission }, uDust: { value: dust }, uA: { value: cA }, uB: { value: cB } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform sampler2D uEmission;uniform sampler2D uDust;uniform vec3 uA;uniform vec3 uB;
      void main(){
        float radius=length(vUv-.5)*2.;
        vec3 stars=texture2D(uEmission,vUv).rgb;
        float dust=texture2D(uDust,vUv).r;
        vec3 tint=mix(vec3(1.,.83,.61),mix(uA,uB,.45),smoothstep(.08,.8,radius));
        vec3 light=stars*mix(vec3(1.),tint,.3)*2.3;
        float alpha=clamp(max(max(stars.r,stars.g),stars.b)*4.+dust*.22,0.,.92);
        gl_FragColor=vec4(light*(1.-dust*.35),alpha*(1.-smoothstep(.87,1.,radius)));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }), [emission, dust, cA, cB]);

  // --- Diffuse stellar spiral arms. ---
  const armGeometry = useMemo(() => {
    const random = seededRandom(42);
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
      const radiusProgress = Math.pow(random(), 0.72);
      const radius = 0.16 + radiusProgress * 3.95;
      const armAngle = (arm / ARM_COUNT) * Math.PI * 2 + -radius * 1.33 + Math.sin(radius * 3.1 + arm) * 0.08;
      const lateralSpread = 0.09 + radiusProgress * 0.28;
      const lateral = (random() + random() + random() - 1.5) * lateralSpread;
      const angle = armAngle + lateral;

      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (random() - 0.5) * (0.12 + radiusProgress * 0.24);
      positions[index * 3 + 2] = Math.sin(angle) * radius;

      const color = cHot.clone().lerp(cB, Math.min(1, radiusProgress * 1.15));
      const brightness = 0.72 + random() * 0.5;
      colors[index * 3] = Math.min(1, color.r * brightness);
      colors[index * 3 + 1] = Math.min(1, color.g * brightness);
      colors[index * 3 + 2] = Math.min(1, color.b * brightness);
      sizes[index] = 0.18 + random() * 0.62;
      seeds[index] = random();
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
    const random = seededRandom(84);
    const count = Math.max(
      15,
      Math.floor(
        180 * (mobile ? 0.5 : 1) * (particleDensity === "low" ? 0.6 : 1) * tierParticleMultiplier(tier),
      ),
    );
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const arm = i % ARM_COUNT;
      const t = Math.pow(random(), 0.9);
      const r = 0.7 + t * 3.0;
      const angle = (arm / ARM_COUNT) * Math.PI * 2 + r * 1.1;
      const lateral = (random() - 0.5) * 0.3;
      const x = Math.cos(angle) * r + Math.cos(angle + Math.PI / 2) * lateral;
      const z = Math.sin(angle) * r + Math.sin(angle + Math.PI / 2) * lateral;
      const y = (random() - 0.5) * 0.18;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      sizes[i] = 0.45 + random() * 0.8;
      seeds[i] = random();

      const col = random() > 0.6 ? cHot : cB;
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
            gl_PointSize = size * uPixelRatio * tw * (60.0 / safeDepth);
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
            a = pow(a, 1.4);
            gl_FragColor = vec4(vColor * 1.15, a * .75);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => () => { coreMaterial.dispose(); coreGlowMaterial.dispose(); diskMaterial.dispose(); }, [coreMaterial, coreGlowMaterial, diskMaterial]);
  useEffect(() => () => armGeometry.dispose(), [armGeometry]);
  useEffect(() => () => sparkleGeometry.dispose(), [sparkleGeometry]);
  useEffect(() => () => sparkleMaterial.dispose(), [sparkleMaterial]);

  useFrame((state, delta) => {
    if (armGroupRef.current) {
      armGroupRef.current.rotation.y += delta * rotationSpeed * 0.12;
    }
    if (groupRef.current) {
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.04;
    }
    if (visualGroupRef.current) {
      // Fixed tilt to show 3D spiral structure - not facing camera directly
      visualGroupRef.current.rotation.x = Math.PI * 0.35;
      visualGroupRef.current.rotation.z = Math.PI * 0.05;
    }
    if (pointsRef.current) pointsRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group ref={groupRef}>
      {/* The procedural arms are authored in the horizontal XZ plane. Tilt
          their assembly toward the +Z reveal camera so it reads as a spiral,
          while keeping the optional heart/star constellation upright. */}
      <group ref={visualGroupRef}>
        {/* Faint galactic disk. */}


        {/* Diffuse stellar arms remain legible around the smaller vinyl. */}
        <group ref={armGroupRef}>
          <mesh material={diskMaterial} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[8.4, 8.4]} />
          </mesh>
          <points ref={pointsRef} geometry={armGeometry} material={sparkleMaterial} />
        </group>

        {/* Bright smooth core with subtle glow aura. */}
        <mesh material={coreMaterial}>
          <sphereGeometry args={[0.08, 32, 32]} />
        </mesh>
        <mesh material={coreGlowMaterial} scale={1.2}>
          <sphereGeometry args={[0.08, 32, 32]} />
        </mesh>

        {/* Sparse arm sparkles. */}
        <points geometry={sparkleGeometry} material={sparkleMaterial} />
      </group>

      {/* Optional central "soul" symbol overlay. */}
      {children}
    </group>
  );
}
