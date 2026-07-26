"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type {
  CreatureAccent,
  CreatureKind,
  CreatureSpec,
} from "@/types/universe";

interface CreatureProps {
  spec: CreatureSpec;
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
}

/**
 * A cute, procedural creature companion in the style of Spore's Creature Stage.
 *
 * The body is built from chubby low-poly blobs: a big rounded head, a smaller
 * torso, stubby arms/legs, big expressive eyes, and a small smiling mouth.
 * Accents (horns, ears, tail, fins, halo, wings) keep the same chunky toy
 * aesthetic. All meshes use flat shading and matte colors so it feels like a
 * colorful 3D critter rather than a glossy balloon.
 */
export function Creature({
  spec,
  primaryColor,
  secondaryColor,
  rotationSpeed,
}: CreatureProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  const tailRef = useRef<THREE.Mesh>(null);
  const eyeLRef = useRef<THREE.Mesh>(null);
  const eyeRRef = useRef<THREE.Mesh>(null);

  const params = useMemo(() => paramsForKind(spec.kind), [spec.kind]);
  const cSecondary = secondaryColor;

  // Spore-like matte skin with a soft glow, plus flat shading for low-poly look.
  const skinMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(primaryColor),
        emissive: new THREE.Color(primaryColor),
        emissiveIntensity: 0.18,
        roughness: 0.75,
        metalness: 0.0,
        flatShading: true,
      }),
    [primaryColor],
  );

  const accentMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(secondaryColor),
        emissive: new THREE.Color(secondaryColor),
        emissiveIntensity: 0.25,
        roughness: 0.7,
        metalness: 0.0,
        flatShading: true,
      }),
    [secondaryColor],
  );

  const eyeWhiteMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#ffffff"),
        roughness: 0.3,
        metalness: 0.0,
        flatShading: true,
      }),
    [],
  );

  const pupilMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#1a1a2e"),
        roughness: 0.2,
        metalness: 0.0,
        flatShading: true,
      }),
    [],
  );

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    const speed = 0.35 + rotationSpeed * 0.35;
    // Orbit much closer to the camera/user so the creature is visible.
    const radius = 1.4;
    let targetX = 0;
    let targetY = 0;
    let targetZ = 0;
    let yaw = 0;
    let roll = 0;

    switch (spec.motion) {
      case "swim": {
        const a = t * speed * 0.7;
        targetX = Math.sin(a) * radius;
        targetY = Math.sin(a * 2) * 0.7;
        targetZ = Math.cos(a) * radius * 0.55;
        yaw = a + Math.PI / 2;
        roll = Math.sin(a) * 0.25;
        break;
      }
      case "fly": {
        const a = t * speed * 0.65;
        targetX = Math.cos(a) * radius;
        targetY = Math.sin(t * speed * 0.45) * 0.9;
        targetZ = Math.sin(a) * radius;
        yaw = a + Math.PI / 2 + Math.sin(t * 1.5) * 0.2;
        roll = Math.cos(a * 2) * 0.12;
        break;
      }
      case "orbit": {
        const a = t * speed * 0.55;
        targetX = Math.cos(a) * radius;
        targetY = Math.sin(a * 0.35) * 0.5;
        targetZ = Math.sin(a) * radius;
        yaw = a + Math.PI / 2;
        break;
      }
      case "bob":
      default: {
        targetX = Math.sin(t * speed * 0.3) * 0.7;
        targetY = Math.sin(t * speed * 0.8) * 0.55;
        targetZ = Math.cos(t * speed * 0.3) * 0.5;
        yaw = Math.sin(t * speed * 0.4) * 0.5;
        roll = Math.sin(t * speed * 0.55) * 0.12;
        break;
      }
    }

    groupRef.current.position.set(targetX, targetY, targetZ);
    groupRef.current.rotation.y = yaw;
    groupRef.current.rotation.z = roll;

    // Cute body waddle / bounce.
    if (bodyRef.current) {
      const breathe = 1 + Math.sin(t * 3.5) * 0.035;
      bodyRef.current.scale.set(breathe, breathe, breathe);
      bodyRef.current.rotation.z = Math.sin(t * 2.8) * 0.08;
      bodyRef.current.rotation.x = Math.sin(t * 2.2) * 0.05;
    }

    // Wing flap.
    const flap = Math.sin(t * 9) * 0.55;
    if (wingLRef.current) wingLRef.current.rotation.z = 0.25 + flap;
    if (wingRRef.current) wingRRef.current.rotation.z = -0.25 - flap;

    // Tail wag.
    if (tailRef.current) {
      tailRef.current.rotation.y = Math.sin(t * 4.5) * 0.45;
    }

    // Blink.
    const blinkPhase = t % 3.8;
    const blink = blinkPhase < 0.18 ? 0.1 : 1;
    if (eyeLRef.current) eyeLRef.current.scale.y = blink;
    if (eyeRRef.current) eyeRRef.current.scale.y = blink;
  });

  const headY = params.bodyRadius * 0.55;

  return (
    <group ref={groupRef}>
      {/* Soft rim light that makes the creature pop off the galaxy background. */}
      <pointLight color={cSecondary} intensity={1.2} distance={5} position={[0.8, 0.5, 0.8]} />
      <group ref={bodyRef}>
        {/* Body — chubby round blob. */}
        <mesh material={skinMaterial} scale={[1.1, 0.85, 1]}>
          <icosahedronGeometry args={[params.bodyRadius, 0]} />
        </mesh>

        {/* Head — big round blob sitting on top/front. */}
        <mesh
          material={skinMaterial}
          position={[params.bodyRadius * 0.35, headY, 0]}
        >
          <icosahedronGeometry args={[params.headRadius, 0]} />
        </mesh>

        {/* Eyes — large, forward-facing, cute. */}
        <group
          ref={eyeLRef}
          position={[
            params.bodyRadius * 0.35 + params.headRadius * 0.55,
            headY + params.headRadius * 0.1,
            params.headRadius * 0.38,
          ]}
        >
          <mesh material={eyeWhiteMaterial}>
            <icosahedronGeometry args={[params.headRadius * 0.28, 0]} />
          </mesh>
          <mesh
            material={pupilMaterial}
            position={[params.headRadius * 0.14, 0, 0]}
          >
            <icosahedronGeometry args={[params.headRadius * 0.12, 0]} />
          </mesh>
        </group>
        <group
          ref={eyeRRef}
          position={[
            params.bodyRadius * 0.35 + params.headRadius * 0.55,
            headY + params.headRadius * 0.1,
            -params.headRadius * 0.38,
          ]}
        >
          <mesh material={eyeWhiteMaterial}>
            <icosahedronGeometry args={[params.headRadius * 0.28, 0]} />
          </mesh>
          <mesh
            material={pupilMaterial}
            position={[params.headRadius * 0.14, 0, 0]}
          >
            <icosahedronGeometry args={[params.headRadius * 0.12, 0]} />
          </mesh>
        </group>

        {/* Mouth — tiny smile. */}
        <mesh
          material={accentMaterial}
          position={[
            params.bodyRadius * 0.35 + params.headRadius * 0.65,
            headY - params.headRadius * 0.28,
            0,
          ]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[0.8, 1.3, 0.5]}
        >
          <torusGeometry args={[params.headRadius * 0.1, params.headRadius * 0.05, 4, 8]} />
        </mesh>

        {/* Arms — short nubs sticking out the sides. */}
        <mesh
          material={skinMaterial}
          position={[0, -params.bodyRadius * 0.15, params.bodyRadius * 0.85]}
          rotation={[0.5, 0, 0.2]}
          scale={[0.8, 1, 0.8]}
        >
          <capsuleGeometry args={[params.limbRadius, params.limbLength, 4, 5]} />
        </mesh>
        <mesh
          material={skinMaterial}
          position={[0, -params.bodyRadius * 0.15, -params.bodyRadius * 0.85]}
          rotation={[-0.5, 0, 0.2]}
          scale={[0.8, 1, 0.8]}
        >
          <capsuleGeometry args={[params.limbRadius, params.limbLength, 4, 5]} />
        </mesh>

        {/* Legs — short nubs sticking down. */}
        <mesh
          material={skinMaterial}
          position={[-params.bodyRadius * 0.2, -params.bodyRadius * 0.75, params.bodyRadius * 0.45]}
          rotation={[0.4, 0, -0.2]}
          scale={[0.9, 1, 0.9]}
        >
          <capsuleGeometry args={[params.limbRadius, params.legLength, 4, 5]} />
        </mesh>
        <mesh
          material={skinMaterial}
          position={[-params.bodyRadius * 0.2, -params.bodyRadius * 0.75, -params.bodyRadius * 0.45]}
          rotation={[-0.4, 0, -0.2]}
          scale={[0.9, 1, 0.9]}
        >
          <capsuleGeometry args={[params.limbRadius, params.legLength, 4, 5]} />
        </mesh>

        {/* Tail. */}
        <mesh
          ref={tailRef}
          material={accentMaterial}
          position={[-params.bodyRadius * 0.75, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
          scale={[1, params.tailBulb, 1]}
        >
          <coneGeometry args={[params.tailRadius, params.tailLength, 5, 1]} />
        </mesh>

        {/* Accent. */}
        <Accent
          kind={spec.accent}
          accentMaterial={accentMaterial}
          headX={params.bodyRadius * 0.35}
          headLift={headY}
          headRadius={params.headRadius}
          bodyLength={params.bodyLength}
          bodyRadius={params.bodyRadius}
          wingLRef={wingLRef}
          wingRRef={wingRRef}
        />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Per-kind body proportions — big head, small body = cute Spore formula.
// ---------------------------------------------------------------------------

interface KindParams {
  bodyRadius: number;
  bodyLength: number;
  headRadius: number;
  tailLength: number;
  tailRadius: number;
  tailBulb: number;
  limbRadius: number;
  limbLength: number;
  legLength: number;
}

function paramsForKind(kind: CreatureKind): KindParams {
  // Head is always a bit bigger than body radius for the cute Spore look.
  // Values are intentionally chunky so the creature is visible against the galaxy.
  switch (kind) {
    case "fish":
      return {
        bodyRadius: 0.42,
        bodyLength: 1.1,
        headRadius: 0.46,
        tailLength: 1.0,
        tailRadius: 0.36,
        tailBulb: 1.2,
        limbRadius: 0.09,
        limbLength: 0.28,
        legLength: 0.18,
      };
    case "bird":
      return {
        bodyRadius: 0.35,
        bodyLength: 0.85,
        headRadius: 0.4,
        tailLength: 0.5,
        tailRadius: 0.22,
        tailBulb: 1,
        limbRadius: 0.08,
        limbLength: 0.24,
        legLength: 0.35,
      };
    case "fox":
      return {
        bodyRadius: 0.35,
        bodyLength: 1.0,
        headRadius: 0.44,
        tailLength: 1.1,
        tailRadius: 0.28,
        tailBulb: 1.4,
        limbRadius: 0.09,
        limbLength: 0.28,
        legLength: 0.36,
      };
    case "cat":
      return {
        bodyRadius: 0.35,
        bodyLength: 0.95,
        headRadius: 0.46,
        tailLength: 1.0,
        tailRadius: 0.2,
        tailBulb: 1.3,
        limbRadius: 0.09,
        limbLength: 0.25,
        legLength: 0.32,
      };
    case "dragon":
      return {
        bodyRadius: 0.42,
        bodyLength: 1.2,
        headRadius: 0.46,
        tailLength: 1.3,
        tailRadius: 0.3,
        tailBulb: 1.1,
        limbRadius: 0.11,
        limbLength: 0.32,
        legLength: 0.4,
      };
    case "jelly":
      return {
        bodyRadius: 0.46,
        bodyLength: 0.42,
        headRadius: 0.55,
        tailLength: 0.65,
        tailRadius: 0.32,
        tailBulb: 1,
        limbRadius: 0.08,
        limbLength: 0.36,
        legLength: 0.22,
      };
    case "spirit":
    default:
      return {
        bodyRadius: 0.38,
        bodyLength: 0.7,
        headRadius: 0.5,
        tailLength: 0.22,
        tailRadius: 0.16,
        tailBulb: 1.2,
        limbRadius: 0.09,
        limbLength: 0.22,
        legLength: 0.22,
      };
  }
}

// ---------------------------------------------------------------------------
// Accent (horns / ears / tail / fins / halo / wings / none)
// ---------------------------------------------------------------------------

interface AccentProps {
  kind: CreatureAccent;
  accentMaterial: THREE.Material;
  headX: number;
  headLift: number;
  headRadius: number;
  bodyLength: number;
  bodyRadius: number;
  wingLRef: React.RefObject<THREE.Mesh | null>;
  wingRRef: React.RefObject<THREE.Mesh | null>;
}

function Accent({
  kind,
  accentMaterial,
  headX,
  headLift,
  headRadius,
  bodyRadius,
  wingLRef,
  wingRRef,
}: AccentProps) {
  switch (kind) {
    case "horns":
      return (
        <>
          <mesh
            material={accentMaterial}
            position={[headX + headRadius * 0.1, headLift + headRadius * 1.0, headRadius * 0.35]}
            rotation={[0, 0, -0.35]}
          >
            <coneGeometry args={[headRadius * 0.12, headRadius * 0.6, 5, 1]} />
          </mesh>
          <mesh
            material={accentMaterial}
            position={[headX + headRadius * 0.1, headLift + headRadius * 1.0, -headRadius * 0.35]}
            rotation={[0, 0, -0.35]}
          >
            <coneGeometry args={[headRadius * 0.12, headRadius * 0.6, 5, 1]} />
          </mesh>
        </>
      );
    case "ears":
      return (
        <>
          <mesh
            material={accentMaterial}
            position={[headX - headRadius * 0.1, headLift + headRadius * 1.15, headRadius * 0.45]}
            rotation={[0.2, 0, -0.25]}
          >
            <coneGeometry args={[headRadius * 0.2, headRadius * 0.55, 4, 1]} />
          </mesh>
          <mesh
            material={accentMaterial}
            position={[headX - headRadius * 0.1, headLift + headRadius * 1.15, -headRadius * 0.45]}
            rotation={[-0.2, 0, -0.25]}
          >
            <coneGeometry args={[headRadius * 0.2, headRadius * 0.55, 4, 1]} />
          </mesh>
        </>
      );
    case "wings":
      return (
        <>
          <mesh
            ref={wingLRef}
            material={accentMaterial}
            position={[0, bodyRadius * 0.5, bodyRadius * 1.25]}
            rotation={[Math.PI / 2, 0, 0.25]}
          >
            <boxGeometry args={[bodyRadius * 0.8, bodyRadius * 1.6, bodyRadius * 0.05]} />
          </mesh>
          <mesh
            ref={wingRRef}
            material={accentMaterial}
            position={[0, bodyRadius * 0.5, -bodyRadius * 1.25]}
            rotation={[Math.PI / 2, 0, -0.25]}
          >
            <boxGeometry args={[bodyRadius * 0.8, bodyRadius * 1.6, bodyRadius * 0.05]} />
          </mesh>
        </>
      );
    case "halo":
      return (
        <mesh
          material={accentMaterial}
          position={[headX, headLift + headRadius * 1.5, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[headRadius * 0.9, headRadius * 0.06, 4, 16]} />
        </mesh>
      );
    case "fins":
      return (
        <>
          <mesh
            material={accentMaterial}
            position={[-bodyRadius * 0.6, 0, bodyRadius * 1.1]}
            rotation={[0.3, 0.4, 0]}
          >
            <coneGeometry args={[bodyRadius * 0.45, bodyRadius * 0.9, 3, 1]} />
          </mesh>
          <mesh
            material={accentMaterial}
            position={[-bodyRadius * 0.6, 0, -bodyRadius * 1.1]}
            rotation={[-0.3, -0.4, 0]}
          >
            <coneGeometry args={[bodyRadius * 0.45, bodyRadius * 0.9, 3, 1]} />
          </mesh>
        </>
      );
    case "tail":
      // Tail tuft.
      return (
        <mesh
          material={accentMaterial}
          position={[-bodyRadius * 1.4, 0, 0]}
        >
          <icosahedronGeometry args={[headRadius * 0.35, 0]} />
        </mesh>
      );
    case "none":
    default:
      return null;
  }
}
