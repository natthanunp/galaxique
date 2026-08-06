"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
    // Perches near the (DOM) vinyl disc at a fixed scene-origin-relative
    // radius, so the creature reads as a companion to the song rather
    // than a sentinel glued to the camera. The exact world-space vinyl
    // position is unimportant — the disc is a DOM element projected over
    // the galaxy, so any companion at ~2.5 units from the origin sits
    // visibly near it. Different motions map to different scene-relative
    // positions/orbits:
    //   - fly/orbit: orbits the origin at radius 2.5–3.0 (wing-flapping
    //     for bird/dragon; survey-look for fox/cat)
    //   - bob: floats gently at a fixed perch offset (jelly/spirit)
    //   - swim: drifts in a slow sinusoidal path near the disc (fish)
    const perchRadius = 2.6;
    const target = targetRef.current;

    switch (spec.motion) {
      case "fly":
        target.set(
          Math.cos(angle) * perchRadius + Math.sin(angle * 0.6) * 0.4,
          0.6 + Math.sin(angle * 1.6) * 0.45,
          Math.sin(angle) * perchRadius * 0.7,
        );
        break;
      case "swim":
        target.set(
          Math.sin(angle * 0.9) * 1.4,
          Math.sin(angle * 1.7) * 0.4,
          1.8 + Math.cos(angle * 0.7) * 0.6,
        );
        break;
      case "bob":
        target.set(
          1.5 + Math.sin(angle * 0.7) * 0.25,
          0.4 + Math.sin(angle * 2) * 0.35,
          1.8,
        );
        break;
      case "orbit":
      default:
        target.set(
          Math.cos(angle) * perchRadius,
          0.4 + Math.sin(angle) * 0.5,
          Math.sin(angle) * perchRadius * 0.7,
        );
        break;
    }

    group.position.lerp(target, 0.12);
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
      <pointLight color={secondaryColor} intensity={1.2} distance={8} />
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