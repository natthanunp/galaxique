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
    // Drifts far behind the central object instead of up front like the
    // other companions — camera sits ~8 units from the origin, so a distance
    // beyond that puts the jelly past the galaxy from the camera's view.
    url: "/assets/creatures/jelly.glb",
    scale: 1.1,
    rotationY: 0,
    animation: "ArmatureAction.001",
    distance: 9.5,
  },
  spirit: {
    url: "/assets/creatures/spirit.glb",
    scale: 0.15,
    rotationY: Math.PI / 2,
    animation: "Scene",
  },
} as const;

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
  const forwardRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const targetRef = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const { scene, animations } = useGLTF(model.url);
  const { actions } = useAnimations(animations, groupRef);
  const modelScene = useMemo(() => {
    // SkeletonUtils.clone (not Object3D.clone) is required for rigged models:
    // a plain clone duplicates the bones but leaves SkinnedMesh.skeleton
    // pointing at the ORIGINAL bones, so the mixer animates bones nothing
    // renders from and the model appears completely static.
    const clone = cloneSkinned(scene) as THREE.Group;
    const glowColor = new THREE.Color(primaryColor);
    clone.scale.setScalar(model.scale);

    clone.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;

      const configureMaterial = (material: THREE.Material) => {
        const litMaterial = material.clone();
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
    const forward = camera.getWorldDirection(forwardRef.current);
    const right = rightRef.current.crossVectors(forward, camera.up).normalize();
    const target = targetRef.current;
    const companionDistance = "distance" in model ? model.distance : 5.5;
    const verticalOffset = 0;

    switch (spec.motion) {
      case "fly":
        target
          .copy(camera.position)
          .addScaledVector(forward, companionDistance)
          .addScaledVector(right, Math.cos(angle) * 1.65)
          .addScaledVector(camera.up, verticalOffset + 0.15 + Math.sin(angle * 1.6) * 0.58);
        break;
      case "swim":
        target
          .copy(camera.position)
          .addScaledVector(forward, companionDistance)
          .addScaledVector(right, Math.sin(angle * 0.9) * 1.5)
          .addScaledVector(camera.up, verticalOffset + Math.sin(angle * 1.7) * 0.4);
        break;
      case "bob":
        target
          .copy(camera.position)
          .addScaledVector(forward, companionDistance)
          .addScaledVector(right, 1.55 + Math.sin(angle * 0.7) * 0.28)
          .addScaledVector(camera.up, verticalOffset + 0.3 + Math.sin(angle * 2) * 0.35);
        break;
      case "orbit":
      default:
        target
          .copy(camera.position)
          .addScaledVector(forward, companionDistance)
          .addScaledVector(right, Math.cos(angle) * 1.45)
          .addScaledVector(camera.up, verticalOffset + 0.08 + Math.sin(angle) * 0.5);
        break;
    }

    group.position.lerp(target, 0.07);
    group.quaternion.copy(camera.quaternion);
    group.rotateY(model.rotationY + Math.sin(time * 0.8) * 0.12);
    group.rotateZ(Math.sin(time * (1.2 + rotationSpeed)) * (spec.kind === "fish" ? 0.12 : 0.04));
    modelScene.scale.setScalar(model.scale);
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
      <pointLight color={secondaryColor} intensity={3} distance={5} />
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