"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { CreatureKind, CreatureSpec } from "@/types/universe";

const CREATURE_MODELS = {
  bird: {
    url: "/assets/creatures/bird.glb",
    scale: 0.22,
    rotationY: Math.PI,
    animation: "Take 001",
  },
  cat: {
    url: "/assets/creatures/cat.glb?v=toon-cat-1",
    scale: 0.0014,
    rotationY: Math.PI,
    animation: "Scene",
  },
  dragon: {
    url: "/assets/creatures/dragon.glb",
    scale: 0.24,
    rotationY: Math.PI,
    animation: "DragonArmature|Dragon_Flying",
  },
  fish: {
    url: "/assets/creatures/fish.glb",
    scale: 1.7,
    rotationY: Math.PI / 2,
  },
  fox: {
    url: "/assets/creatures/fox.glb",
    scale: 0.012,
    rotationY: -Math.PI / 2,
    animation: "Survey",
  },
  jelly: {
    url: "/assets/creatures/jelly.glb",
    scale: 1.1,
    rotationY: 0,
    animation: "ArmatureAction.001",
  },
  spirit: {
    url: "/assets/creatures/spirit.glb",
    scale: 0.15,
    rotationY: Math.PI / 2,
    animation: "Scene",
  },
} as const;

const COMPANION_SCALE = 5.1;
const COMPANION_OPACITY = 0.66;

interface SwimShader {
  uniforms: Record<string, THREE.IUniform>;
}

export function hasCreatureModel(kind: CreatureKind): kind is keyof typeof CREATURE_MODELS {
  return kind in CREATURE_MODELS;
}

interface CreatureModelProps {
  spec: CreatureSpec;
  primaryColor: string;
  secondaryColor: string;
  rotationSpeed: number;
}

export function CreatureModel({
  spec,
  primaryColor,
  secondaryColor,
  rotationSpeed,
}: CreatureModelProps) {
  const model = hasCreatureModel(spec.kind) ? CREATURE_MODELS[spec.kind] : CREATURE_MODELS.fox;
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const { camera, size } = useThree();
  const { scene, animations } = useGLTF(model.url);
  const { actions } = useAnimations(animations, groupRef);
  const modelScene = useMemo(() => {
    // SkeletonUtils.clone (not Object3D.clone) is required for rigged models:
    // a plain clone duplicates the bones but leaves SkinnedMesh.skeleton
    // pointing at the ORIGINAL bones, so the mixer animates bones nothing
    // renders from and the model appears completely static.
    const clone = cloneSkinned(scene) as THREE.Group;
    const glowColor = new THREE.Color(primaryColor);
    clone.scale.setScalar(model.scale * COMPANION_SCALE);

    clone.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;

      // book_spirit.glb includes a separate, floating Glasses mesh. It reads
      // as two detached circles above the companion in the reveal scene.
      if (
        spec.kind === "spirit" &&
        [node.name, node.geometry.name].some((name) =>
          name.toLowerCase().includes("glasses"),
        )
      ) {
        node.visible = false;
        return;
      }

      const configureMaterial = (material: THREE.Material) => {
        const litMaterial = material.clone();
        // A large companion should feel embedded in the galaxy, not like an
        // opaque sticker over it. Keep its original texture while letting
        // stars and the spiral subtly read through its silhouette.
        litMaterial.transparent = true;
        litMaterial.opacity = COMPANION_OPACITY;
        litMaterial.depthWrite = false;
        litMaterial.blending = THREE.NormalBlending;
        if ("emissive" in litMaterial) {
          const emissiveMaterial = litMaterial as THREE.MeshStandardMaterial;
          emissiveMaterial.emissive.copy(glowColor);
          emissiveMaterial.emissiveIntensity = spec.kind === "fish" ? 0.42 : 0.16;
        }
        if (spec.kind === "fish" && litMaterial instanceof THREE.MeshStandardMaterial) {
          litMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uSwimTime = { value: 0 };
            shader.vertexShader = `uniform float uSwimTime;\n${shader.vertexShader}`.replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
              float tailWeight = smoothstep(0.04, 0.32, abs(transformed.z));
              transformed.y += sin(uSwimTime * 7.0 + transformed.z * 22.0) * 0.045 * tailWeight;`,
            );
            litMaterial.userData.swimShader = shader;
          };
          litMaterial.customProgramCacheKey = () => "galaxseea-fish-swim-v1";
        }
        return litMaterial;
      };

      node.material = Array.isArray(node.material)
        ? node.material.map(configureMaterial)
        : configureMaterial(node.material);
    });

    return clone;
  }, [model, primaryColor, scene, spec.kind]);

  useEffect(() => {
    const action = "animation" in model ? actions[model.animation] : undefined;
    action?.reset().fadeIn(0.25).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, model]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;

    const time = state.clock.elapsedTime;
    const speed = 0.38 + rotationSpeed * 0.22;
    const angle = time * speed;
    // The record is DOM, while the companion is 3D. Put the companion in a
    // camera-relative perch so it remains a clear focal detail beside the
    // record even while OrbitControls rotate the scene. The offset is kept
    // in the same depth plane as the origin, so it still reads as part of
    // the galaxy rather than as an interface sticker.
    camera.updateWorldMatrix(true, false);
    const cameraRight = cameraRightRef.current
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    const cameraUp = cameraUpRef.current
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .normalize();
    const narrowViewport = size.width < 640;
    const perchX = narrowViewport ? 1.7 : 3.55;
    const perchY = narrowViewport ? 1.35 : 1.5;
    const orbitRadius = narrowViewport ? 0.62 : 1.2;
    const target = targetRef.current;

    switch (spec.motion) {
      case "fly":
        target.set(
          0,
          0,
          0,
        );
        target.addScaledVector(cameraRight, perchX + Math.cos(angle) * orbitRadius);
        target.addScaledVector(cameraUp, perchY + Math.sin(angle * 1.35) * orbitRadius * 0.62);
        break;
      case "swim":
        target.set(
          0,
          0,
          0,
        );
        target.addScaledVector(cameraRight, perchX + Math.sin(angle * 0.9) * orbitRadius * 0.9);
        target.addScaledVector(cameraUp, perchY + Math.sin(angle * 1.7) * orbitRadius * 0.55);
        break;
      case "bob":
        target.set(
          0,
          0,
          0,
        );
        target.addScaledVector(cameraRight, perchX + Math.sin(angle * 0.7) * orbitRadius * 0.42);
        target.addScaledVector(cameraUp, perchY + Math.sin(angle * 2) * orbitRadius * 0.62);
        break;
      case "orbit":
      default:
        target.set(
          0,
          0,
          0,
        );
        target.addScaledVector(cameraRight, perchX + Math.cos(angle) * orbitRadius);
        target.addScaledVector(cameraUp, perchY + Math.sin(angle * 1.25) * orbitRadius * 0.54);
        break;
    }

    group.position.lerp(target, 0.16);
    // Face the galaxy center (origin), then apply the per-model
    // `rotationY` offset so each creature's forward orientation is
    // preserved (e.g. bird needs Math.PI to face forward).
    group.lookAt(0, 0, 0);
    group.rotateY(model.rotationY);
    // Tiny wobble only for the fish (no GLB bone animation to drive
    // organic motion). Other models let the bone animation handle
    // their motion — the previous manual rotation wobble created a
    // "double-animated" look on top of the GLB animation.
    if (spec.kind === "fish") {
      group.rotateZ(Math.sin(time * (1.2 + rotationSpeed)) * 0.05);
    }
    modelScene.scale.setScalar(model.scale * COMPANION_SCALE);
    modelScene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        const shader = material.userData.swimShader as SwimShader | undefined;
        if (shader) shader.uniforms.uSwimTime.value = time;
      }
    });
  });

  return (
    <group ref={groupRef}>
      <pointLight
        color={secondaryColor}
        intensity={2.1}
        distance={6}
        position={[0.8, 1.1, 1.4]}
      />
      <primitive object={modelScene} />
      {spec.accent === "halo" && (
        <mesh position={[0, 1.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.52, 0.045, 8, 24]} />
          <meshBasicMaterial color={primaryColor} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}

for (const model of Object.values(CREATURE_MODELS)) {
  useGLTF.preload(model.url);
}