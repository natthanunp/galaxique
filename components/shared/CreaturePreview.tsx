"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useRef } from "react";
import * as THREE from "three";

import type { CreatureKind } from "@/types/universe";

const CREATURE_MODELS: Record<CreatureKind, { url: string; scale: number; rotationY: number }> = {
  bird:   { url: "/assets/creatures/bird.glb", scale: 0.22, rotationY: Math.PI },
  cat:    { url: "/assets/creatures/cat.glb?v=toon-cat-1", scale: 0.0014, rotationY: Math.PI },
  dragon: { url: "/assets/creatures/dragon.glb", scale: 0.24, rotationY: Math.PI },
  fish:   { url: "/assets/creatures/fish.glb", scale: 1.7, rotationY: Math.PI / 2 },
  fox:    { url: "/assets/creatures/fox.glb", scale: 0.012, rotationY: -Math.PI / 2 },
  jelly:  { url: "/assets/creatures/jelly.glb", scale: 1.1, rotationY: 0 },
  spirit: { url: "/assets/creatures/spirit.glb", scale: 0.15, rotationY: Math.PI / 2 },
};

function RotatingCreature({ kind }: { kind: CreatureKind }) {
  const config = CREATURE_MODELS[kind];
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(config.url);

  useFrame((_state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={scene.clone()}
        scale={config.scale * 55}
        rotation={[0, config.rotationY + Math.PI, 0]}
        position={[0, -0.2, 0]}
      />
    </group>
  );
}

interface CreaturePreviewProps {
  kind: CreatureKind;
  color: string;
  size?: number;
}

export function CreaturePreview({ kind, color, size = 80 }: CreaturePreviewProps) {
  return (
    <div style={{ width: size, height: size }} className="shrink-0 overflow-hidden rounded-full">
      <Canvas
        camera={{ position: [0, 0.2, 3.5], fov: 38 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        dpr={1.5}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.8} />
        <pointLight position={[2, 2, 2]} intensity={1.5} />
        <pointLight position={[-2, -1, -2]} intensity={0.8} color={color} />
        <Suspense fallback={null}>
          <RotatingCreature kind={kind} />
        </Suspense>
      </Canvas>
    </div>
  );
}

for (const config of Object.values(CREATURE_MODELS)) {
  useGLTF.preload(config.url);
}
