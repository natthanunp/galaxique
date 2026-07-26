"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface NeutronStarProps {
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
  /** Optional overlay (e.g. a heart / star symbol) rendered at the core. */
  children?: ReactNode;
}

/**
 * A neutron star: a small intensely glowing core that pulses, plus two
 * cone-shaped pulsar jets shooting from the poles (shader-driven, flowing
 * outward). The whole thing slowly rotates so the jets sweep like a lighthouse.
 */
export function NeutronStar({
  primaryColor,
  secondaryColor,
  rotationSpeed,
  children,
}: NeutronStarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const coreMatRef = useRef<THREE.ShaderMaterial>(null);
  const jetMatRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();

  const coreMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(primaryColor) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          uniform float uTime;
          uniform vec3 uColor;
          void main() {
            // Fresnel rim glow.
            float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.0);
            // Pulse.
            float pulse = 0.7 + 0.3 * sin(uTime * 4.0);
            vec3 col = uColor * (0.6 + fres * 1.4) * pulse;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [primaryColor],
  );

  const jetMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(secondaryColor) },
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
          uniform vec3 uColor;
          void main() {
            // vUv.y runs along the jet length (0 = base, 1 = tip).
            float along = vUv.y;
            // Flowing streaks moving toward the tip.
            float flow = sin(along * 12.0 - uTime * 5.0) * 0.5 + 0.5;
            // Fade out toward the tip and at the narrow base.
            float fade = smoothstep(1.0, 0.2, along) * smoothstep(0.0, 0.15, along);
            // Width-wise soft edge (vUv.x ~ 0.5 at center).
            float width = 1.0 - abs(vUv.x - 0.5) * 2.0;
            width = smoothstep(0.0, 1.0, width);
            float a = fade * width * (0.3 + flow * 0.5);
            gl_FragColor = vec4(uColor * 1.5, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [secondaryColor],
  );

  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed * 0.5;
    }
    coreMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    jetMaterial.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group ref={groupRef}>
      {/* Glowing core sphere. */}
      <mesh material={coreMaterial}>
        <sphereGeometry args={[0.4, 48, 48]} />
      </mesh>

      {/* Outer soft glow halo. */}
      <mesh scale={1.6}>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshBasicMaterial
          color={primaryColor}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Pulsar jets — two cones along the y axis, pointing opposite ways. */}
      <mesh material={jetMaterial} position={[0, 1.1, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.28, 2.2, 32, 1, true]} />
      </mesh>
      <mesh material={jetMaterial} position={[0, -1.1, 0]}>
        <coneGeometry args={[0.28, 2.2, 32, 1, true]} />
      </mesh>

      {/* Optional central "soul" symbol overlay. */}
      {children}
    </group>
  );
}
