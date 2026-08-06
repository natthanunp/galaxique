"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BlackHoleVisualConfig } from "@/types/universe";

interface BlackHoleProps {
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  config?: BlackHoleVisualConfig;
  /** Optional overlay (e.g. a heart / star symbol) rendered near the core. */
  children?: ReactNode;
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
 * A black hole built from radially-symmetric geometry so it can never look
 * stretched or edge-on, no matter the viewport shape or camera FOV.
 *
 *  - A dark event-horizon sphere at the center.
 *  - A bright photon ring (additive torus) around it.
 *  - A volumetric accretion shell made of thousands of orbiting particles
 *    on spherical coordinates. Because the shell is 3D, rotating it looks
 *    like a swirling disc from every angle and never collapses to a flat
 *    oval like the previous ringGeometry approach.
 *  - A soft radial lensing glow for silhouette.
 */
export function BlackHole({
  primaryColor,
  secondaryColor,
  rotationSpeed,
  config,
  children,
}: BlackHoleProps) {
  const seed = config?.seed ?? 928_137_461;
  const random = useMemo(() => seededRandom(seed), [seed]);
  const shellRef = useRef<THREE.Points>(null);
  const photonRef = useRef<THREE.Mesh>(null);

  const count = 2_800;
  const { shellGeometry, shellMaterial, photonMaterial } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    const colorA = new THREE.Color(primaryColor);
    const colorB = new THREE.Color(secondaryColor);
    const inner = 0.65;
    const outer = 1.35;

    for (let i = 0; i < count; i++) {
      // Distribute particles in a thin equatorial shell so it reads as a
      // disc, but we use 3D spherical coordinates so the shape is
      // inherently round from every viewing angle.
      const r = inner + Math.pow(random(), 0.75) * (outer - inner);
      const theta = random() * Math.PI * 2;
      const phi = Math.PI / 2 + (random() - 0.5) * 0.25; // thin disc band

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi) * 0.35; // slightly flattened

      const mixFactor = random();
      const c = colorB.clone().lerp(colorA, mixFactor);
      // Hot streaks.
      if (random() > 0.92) c.lerp(new THREE.Color("#fff5d6"), 0.55);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = 0.06 + random() * 0.09;
      phases[i] = random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + aPhase * 3.0);
          gl_PointSize = max(1.0, aSize * uPixelRatio * 180.0 / -mv.z) * pulse;
          vAlpha = 0.35 + 0.4 * pulse;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const photon = new THREE.MeshBasicMaterial({
      color: colorA,
      transparent: true,
      opacity: config?.photon_ring_strength ?? 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    return { shellGeometry: geometry, shellMaterial: material, photonMaterial: photon };
  }, [config?.photon_ring_strength, primaryColor, secondaryColor, random]);

  useFrame((state, delta) => {
    if (shellRef.current) {
      shellRef.current.rotation.z += delta * rotationSpeed * 0.35;
    }
    if (photonRef.current) {
      photonRef.current.rotation.z -= delta * rotationSpeed * 0.08;
    }
    shellMaterial.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      {/* Soft radial lensing backdrop — a sphere with a transparent
          additive radial gradient shader so the silhouette is visible. */}
      <LensingGlow primaryColor={primaryColor} secondaryColor={secondaryColor} />

      {/* Volumetric accretion shell — thousands of particles in a thin
          3D disc. Always round from any angle. */}
      <points ref={shellRef} geometry={shellGeometry} material={shellMaterial} />

      {/* Photon ring — a thin additive torus, also radially symmetric. */}
      <mesh ref={photonRef} material={photonMaterial} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.58, 0.035, 16, 120]} />
      </mesh>

      {/* Event horizon — dark sphere. */}
      <mesh>
        <sphereGeometry args={[0.52, 32, 32]} />
        <meshBasicMaterial color="#020205" />
      </mesh>

      {children}
    </group>
  );
}

/** A radial glow sphere that always looks circular. */
function LensingGlow({
  primaryColor,
  secondaryColor,
}: {
  primaryColor: string;
  secondaryColor: string;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColorA: { value: new THREE.Color(primaryColor) },
          uColorB: { value: new THREE.Color(secondaryColor) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          void main() {
            float r = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
            if (r < 0.35 || r > 0.95) discard;
            float a = smoothstep(0.95, 0.55, r) * smoothstep(0.35, 0.55, r);
            vec3 col = mix(uColorB, uColorA, smoothstep(0.55, 0.9, r));
            gl_FragColor = vec4(col, a * 0.45);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [primaryColor, secondaryColor],
  );

  return (
    <mesh material={material}>
      <sphereGeometry args={[1.7, 48, 48]} />
    </mesh>
  );
}
