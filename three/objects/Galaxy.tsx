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

const ARM_SEGMENTS = { high: 50, medium: 38, low: 26 };
const ARM_RINGS = 7; // radial segments around each arm
const ARM_COUNT = 4;

/**
 * A sculptural low-poly spiral galaxy.
 *
 * The arms are continuous tapered tubes (not disconnected chunks) that follow
 * a logarithmic spiral, flatten into the galactic plane, and gradient from the
 * hot primary color at the core to the secondary color at the tips. A bright
 * faceted core sits at the center and a very faint disk provides context. The
 * result is immediately readable as a spiral galaxy.
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
  const segments = Math.max(
    10,
    Math.floor(ARM_SEGMENTS[particleDensity] * (mobile ? 0.65 : 1) * tierParticleMultiplier(tier)),
  );

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

  const armMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cB,
        emissive: cA,
        emissiveIntensity: 0.22,
        roughness: 0.65,
        metalness: 0.05,
        flatShading: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    [cA, cB],
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

  // --- Continuous tapered spiral-arm geometry. ---
  const armGeometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const ringsPerArm: THREE.Vector3[][] = [];

    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const armBase = (arm / ARM_COUNT) * Math.PI * 2;
      const ringCenters: THREE.Vector3[] = [];
      const tangents: THREE.Vector3[] = [];

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        // Ease out so the arm extends gracefully to the tip.
        const r = 0.45 + (3.8 - 0.45) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const twist = r * 1.1;
        const angle = armBase + twist;

        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        // Gentle vertical arc: arms sit flat in the disk.
        const y = Math.sin(t * Math.PI) * 0.12 * (1 - t * 0.5);
        ringCenters.push(new THREE.Vector3(x, y, z));

        // Approximate tangent for the next ring.
        const dt = 0.02;
        const t2 = Math.min(1, t + dt);
        const r2 = 0.45 + (3.8 - 0.45) * (t2 < 0.5 ? 2 * t2 * t2 : 1 - Math.pow(-2 * t2 + 2, 2) / 2);
        const a2 = armBase + r2 * 1.1;
        const p2 = new THREE.Vector3(Math.cos(a2) * r2, y, Math.sin(a2) * r2);
        tangents.push(p2.sub(ringCenters[i]).normalize());
      }

      // Build ring vertices for this arm.
      const armRings: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const center = ringCenters[i];
        const tangent = tangents[i];
        // Up is mostly Y, with a slight bank so the arm follows its spiral.
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
        const normal = new THREE.Vector3().crossVectors(right, tangent).normalize();

        // Taper: thick at core (0.45), thin at tip (0.04). Flatter than tall.
        const radius = 0.45 * (1 - t * 0.88);
        const flatY = radius * 0.35; // flatten into disk

        for (let j = 0; j < ARM_RINGS; j++) {
          const theta = (j / ARM_RINGS) * Math.PI * 2;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const p = center
            .clone()
            .add(right.clone().multiplyScalar(cos * radius))
            .add(normal.clone().multiplyScalar(sin * flatY));
          armRings.push(p);

          // Color gradient: hot core -> secondary mid -> dark tip.
          const color = t < 0.25
            ? cHot.clone().lerp(cA, t / 0.25)
            : cA.clone().lerp(cB, (t - 0.25) / 0.75);
          colors.push(color.r, color.g, color.b);
        }
      }
      ringsPerArm.push(armRings);

      // Indices: connect ring i to ring i+1.
      const baseVertex = positions.length / 3;
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < ARM_RINGS; j++) {
          const a = baseVertex + i * ARM_RINGS + j;
          const b = baseVertex + i * ARM_RINGS + ((j + 1) % ARM_RINGS);
          const c = baseVertex + (i + 1) * ARM_RINGS + j;
          const d = baseVertex + (i + 1) * ARM_RINGS + ((j + 1) % ARM_RINGS);
          indices.push(a, b, d, a, d, c);
        }
      }

      armRings.forEach((p) => {
        positions.push(p.x, p.y, p.z);
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [cA, cB, cHot, segments]);

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

        {/* Continuous low-poly spiral arms. */}
        <group ref={armGroupRef}>
          <mesh geometry={armGeometry} material={armMaterial} />
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
