"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { cn } from "@/lib/utils";
import type { CreatureKind } from "@/types/universe";

const CREATURE_MODELS: Record<CreatureKind, { url: string; rotationY: number; animation?: string }> = {
  bird:   { url: "/assets/creatures/bird.glb", rotationY: Math.PI, animation: "Take 001" },
  cat:    { url: "/assets/creatures/cat.glb?v=toon-cat-1", rotationY: Math.PI, animation: "Scene" },
  dragon: { url: "/assets/creatures/dragon.glb", rotationY: Math.PI, animation: "DragonArmature|Dragon_Flying" },
  fish:   { url: "/assets/creatures/fish.glb", rotationY: Math.PI / 2 },
  fox:    { url: "/assets/creatures/fox.glb", rotationY: -Math.PI / 2, animation: "Run" },
  jelly:  { url: "/assets/creatures/jelly.glb", rotationY: 0, animation: "ArmatureAction.001" },
  spirit: { url: "/assets/creatures/spirit.glb", rotationY: Math.PI / 2, animation: "Scene" },
};

/** Largest bounding-box dimension (world units) each fitted model is scaled
 *  to. The 7 creature GLBs have wildly different raw export scales — fitting
 *  to a fixed bounding-box size (instead of a hand-tuned per-model factor)
 *  keeps every kind consistently filling the preview frame. Sized close to
 *  the ~5.4-unit visible frame height (camera below) so the model reads as
 *  a close-up subject rather than a small icon with empty space around it. */
const FIT_SIZE = 4.4;

function RotatingCreature({ kind }: { kind: CreatureKind }) {
  const config = CREATURE_MODELS[kind];
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(config.url);
  // A plain Object3D.clone() copies each SkinnedMesh's `skeleton` by
  // REFERENCE instead of rebinding it to the cloned bones — the model then
  // renders using the ORIGINAL (unposed/rest) skeleton, which looks like a
  // static, collapsed clump instead of the model's natural pose. SkeletonUtils
  // rebinds the skeleton to the clone so both the rest pose and any played
  // animation render correctly (same fix as three/objects/CreatureModel.tsx).
  const modelScene = useMemo(() => {
    const clone = cloneSkinned(scene) as THREE.Group;
    clone.rotation.y = config.rotationY + Math.PI;
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fitScale = FIT_SIZE / maxDim;
    clone.scale.setScalar(fitScale);
    clone.position.set(-center.x * fitScale, -center.y * fitScale, -center.z * fitScale);
    return clone;
  }, [scene, config.rotationY]);
  const { actions } = useAnimations(animations, groupRef);

  useEffect(() => {
    const action = config.animation ? actions[config.animation] : undefined;
    action?.reset().fadeIn(0.25).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, config.animation]);

  useFrame((_state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={modelScene} />
    </group>
  );
}

interface CreaturePreviewProps {
  kind: CreatureKind;
  color: string;
  size?: number;
  className?: string;
}

export function CreaturePreview({ kind, color, size = 80, className }: CreaturePreviewProps) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn("shrink-0 overflow-hidden rounded-2xl", className)}
    >
      <Canvas
        camera={{ position: [0, 0.3, 6.5], fov: 45 }}
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
