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

/**
 * A stylized black hole with a strong visible silhouette.
 *
 * A dark event-horizon sphere sits inside a bright photon ring, a swirling
 * accretion disk, and a soft gravitational-lensing backdrop. The contrast
 * between the black center and the glowing ring/disk makes it clearly
 * readable even against the dark cosmic background.
 */
export function BlackHole({
  primaryColor,
  secondaryColor,
  rotationSpeed,
  config,
  children,
}: BlackHoleProps) {
  const diskRef = useRef<THREE.Mesh>(null);
  const lensRef = useRef<THREE.Mesh>(null);

  const diskMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(primaryColor) },
        uColorB: { value: new THREE.Color(secondaryColor) },
        uActivity: { value: config?.accretion_activity ?? 0.7 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uActivity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            value += amp * valueNoise(p);
            p *= 2.05;
            amp *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 p = vUv - vec2(0.5);
          float r = length(p) * 2.0;
          float ang = atan(p.y, p.x);

          float inner = 0.32;
          float outer = 1.0;
          if (r < inner || r > outer) discard;

          // Turbulent noise streaked along the swirl direction for a richer,
          // less-uniform accretion disk than pure sine bands.
          vec2 noiseCoord = vec2(ang * 2.4, r * 5.0 - uTime * 1.1);
          float turbulence = fbm(noiseCoord);

          float swirl = sin(ang * 3.0 + r * 10.0 - uTime * 2.0 + turbulence * 3.2);
          float bands = 0.5 + 0.5 * swirl;
          bands = mix(bands, turbulence, 0.45);

          float radial = smoothstep(outer, inner, r);
          float intensity = radial * (0.3 + bands * (0.55 + uActivity));

          vec3 col = mix(uColorB, uColorA, radial);
          // Bright hot streaks where turbulence peaks.
          col += vec3(1.0, 0.9, 0.75) * smoothstep(0.72, 0.95, turbulence) * radial * 0.8;
          col *= intensity * (1.25 + uActivity * 1.35);

          float edge = smoothstep(outer, outer - 0.18, r) *
                       smoothstep(inner, inner + 0.1, r);
          gl_FragColor = vec4(col, edge * 0.98);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }, [config?.accretion_activity, primaryColor, secondaryColor]);

  // Soft gravitational-lensing backdrop so the black sphere silhouettes.
  const lensMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColorA: { value: new THREE.Color(primaryColor) },
          uColorB: { value: new THREE.Color(secondaryColor) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          void main() {
            vec2 p = vUv - vec2(0.5);
            float r = length(p) * 2.0;
            if (r < 0.45 || r > 1.15) discard;
            float a = smoothstep(1.15, 0.55, r) * smoothstep(0.45, 0.7, r);
            vec3 col = mix(uColorB, uColorA, smoothstep(0.55, 1.05, r));
            gl_FragColor = vec4(col * 0.8, a * 0.45);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [primaryColor, secondaryColor],
  );

  useFrame((state, delta) => {
    if (diskRef.current) {
      diskRef.current.rotation.z += delta * rotationSpeed * 0.45;
    }
    if (lensRef.current) {
      lensRef.current.rotation.z -= delta * rotationSpeed * 0.1;
    }
    const material = diskRef.current?.material;
    if (material instanceof THREE.ShaderMaterial) {
      material.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  const photonRingStrength = config?.photon_ring_strength ?? 0.85;

  return (
    <group rotation={[Math.PI / 2.2 + (config?.disc_tilt ?? 0.7) * 0.2, 0, 0]}>
      {/* Gravitational-lensing backdrop — gives the hole a visible edge. */}
      <mesh ref={lensRef} material={lensMaterial}>
        <planeGeometry args={[3.2, 3.2]} />
      </mesh>

      {/* Accretion disk — bright and swirling. */}
      <mesh ref={diskRef} material={diskMaterial}>
        <ringGeometry args={[0.32, 1.05, 96, 1]} />
      </mesh>

      {/* Photon ring — bright thin ring around the horizon. */}
      <mesh>
        <ringGeometry args={[0.52, 0.58, 96, 1]} />
        <meshBasicMaterial
          color={new THREE.Color(primaryColor)}
          transparent
          opacity={photonRingStrength}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Event horizon — a dark sphere. */}
      <mesh>
        <sphereGeometry args={[0.52, 32, 32]} />
        <meshBasicMaterial color="#020205" />
      </mesh>

      {/* Optional central "soul" symbol overlay. */}
      {children}
    </group>
  );
}
