"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import aoManifest from "@/public/assets/creatures/ao/manifest.json";
import { COSMIC } from "@/lib/cosmicVisuals";
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
    animation: "Run",
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
const COMPANION_OPACITY = 0.88;

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
  anchorPosition?: [number, number, number];
}

export function CreatureModel({
  spec,
  primaryColor,
  secondaryColor,
  rotationSpeed,
  anchorPosition = [0, 0, 0],
}: CreatureModelProps) {
  const model = hasCreatureModel(spec.kind) ? CREATURE_MODELS[spec.kind] : CREATURE_MODELS.fox;
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const cameraForwardRef = useRef(new THREE.Vector3());
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
        // Alpha-to-coverage uses the canvas's MSAA samples for a smooth,
        // depth-writing translucent look without the noise of alpha hashing.
        litMaterial.transparent = false;
        litMaterial.alphaHash = false;
        litMaterial.alphaToCoverage = true;
        litMaterial.opacity = COMPANION_OPACITY;
        litMaterial.depthWrite = true;
        litMaterial.blending = THREE.NormalBlending;
        if ("emissive" in litMaterial) {
          const emissiveMaterial = litMaterial as THREE.MeshStandardMaterial;
          emissiveMaterial.emissive.copy(glowColor);
          emissiveMaterial.emissiveIntensity = spec.kind === "fish" ? 0.16 : 0.055;
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
    let active = true;
    const textures: THREE.Texture[] = [];
    const ownedMaterials: THREE.Material[] = [];
    const maps = aoManifest[spec.kind] as Record<string, string>;
    const loader = new THREE.TextureLoader();
    modelScene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        ownedMaterials.push(material);
        const url = maps?.[material.name];
        if (!url || !(material instanceof THREE.MeshStandardMaterial) || !node.geometry.attributes.uv) continue;
        const texture = loader.load(url, () => {
          if (!active) return;
          material.aoMap = texture;
          material.aoMapIntensity = COSMIC.aoIntensity;
          material.needsUpdate = true;
        }, undefined, () => { /* Keep existing material if an AO sidecar is unavailable. */ });
        texture.flipY = false;
        texture.colorSpace = THREE.NoColorSpace;
        texture.channel = 0;
        textures.push(texture);
      }
    });
    return () => {
      active = false;
      textures.forEach(texture => texture.dispose());
      ownedMaterials.forEach(material => material.dispose());
    };
  }, [modelScene, spec.kind]);

  useEffect(() => {
    const action = "animation" in model ? actions[model.animation] : undefined;
    action
      ?.reset()
      .setEffectiveTimeScale(spec.motion === "fly" ? 1.25 : 1)
      .fadeIn(0.25)
      .play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, model, spec.motion]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const time = state.clock.elapsedTime;
    const speed = 0.22 + rotationSpeed * 0.15;
    const angle = time * speed;
    const narrowViewport = size.width < 640;
    const orbitRadius = narrowViewport ? 1.7 : 2.9;
    const verticalRange = narrowViewport ? 1.05 : 1.45;
    const behindCoreDepth = narrowViewport ? 0.7 : 1.2;
    camera.updateWorldMatrix(true, false);
    const cameraRight = cameraRightRef.current
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    const cameraUp = cameraUpRef.current
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .normalize();
    const cameraForward = camera.getWorldDirection(cameraForwardRef.current);
    const target = targetRef.current
      .set(...anchorPosition)
      .addScaledVector(cameraForward, behindCoreDepth);
    let offsetX = 0;
    let offsetY = 0;

    switch (spec.motion) {
      case "fly":
        offsetX = Math.cos(angle) * orbitRadius;
        offsetY = Math.sin(angle * 2) * verticalRange * 0.78;
        break;
      case "swim":
        offsetX = Math.sin(angle) * orbitRadius;
        offsetY = Math.sin(angle * 2) * verticalRange * 0.62;
        break;
      case "bob":
        offsetX = Math.sin(angle) * orbitRadius * 0.58;
        offsetY = verticalRange * 0.9 + Math.sin(angle * 3) * verticalRange * 0.48;
        break;
      case "orbit":
      default:
        offsetX = Math.cos(angle) * orbitRadius;
        offsetY = Math.sin(angle) * verticalRange * 0.65;
        break;
    }

    target.addScaledVector(cameraRight, offsetX);
    target.addScaledVector(cameraUp, offsetY);
    group.position.lerp(target, 1 - Math.exp(-delta * 5));
    // Face the galaxy, not the instantaneous velocity, so the companion
    // follows a clear path without tumbling through every curve.
    group.lookAt(...anchorPosition);
    group.rotateY(model.rotationY);
    // Tiny wobble only for the fish (no GLB bone animation to drive
    // organic motion). Other models let the bone animation handle
    // their motion — the previous manual rotation wobble created a
    // "double-animated" look on top of the GLB animation.
    if (spec.kind === "fish") {
      group.rotateZ(Math.sin(time * (1.2 + rotationSpeed)) * 0.05);
    }
    const pulse = 1 + Math.sin(time * 3.2) * 0.025;
    modelScene.scale.setScalar(model.scale * COMPANION_SCALE * pulse);
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
        intensity={0.8}
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