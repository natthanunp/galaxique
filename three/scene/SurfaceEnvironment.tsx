"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { QualityTier } from "@/lib/perf";
import type { WorldSnapshot } from "@/lib/worldStore";
import {
  createGrassGeometry, createStoneGeometry, createSurfaceInstances, createSurfaceTerrain,
  surfacePalette, surfaceRandom, type SurfaceInstance, type SurfacePalette,
} from "./surfaceLandscape";

const DENSITY = {
  high: { grass: 1800, rock: 140, flower: 130, tree: 36, spire: 12, motes: 140 },
  medium: { grass: 1000, rock: 100, flower: 90, tree: 28, spire: 10, motes: 90 },
  low: { grass: 480, rock: 70, flower: 55, tree: 22, spire: 8, motes: 45 },
} as const;

function createSurfaceNoise(seed: number) {
  const random = surfaceRandom(seed + 601);
  const data = new Uint8Array(128 * 128 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = random() * 255;
    data[offset + 1] = random() * 255;
    data[offset + 2] = random() * 255;
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 128, 128, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function surfaceMaterial(
  palette: SurfacePalette,
  noise: THREE.DataTexture,
  time: THREE.IUniform<number>,
  wind: THREE.IUniform<number>,
  kind: "terrain" | "stone" | "grass" | "bark" | "leaf" | "flower" | "crystal",
) {
  const color = kind === "grass" || kind === "leaf" ? palette.foliage
    : kind === "flower" ? palette.blossom
      : kind === "bark" ? new THREE.Color("#777266")
        : kind === "terrain" ? palette.soil : palette.stone;
  const material = new THREE.MeshStandardMaterial({
    color, roughness: kind === "crystal" ? 0.38 : 0.92,
    metalness: kind === "crystal" ? 0.18 : 0,
    flatShading: kind !== "grass", side: kind === "grass" ? THREE.DoubleSide : THREE.FrontSide,
    emissive: kind === "flower" || kind === "crystal" ? palette.glow : new THREE.Color("#000000"),
    emissiveIntensity: kind === "flower" ? 0.65 : kind === "crystal" ? 0.12 : 0,
  });
  material.customProgramCacheKey = () => `surface-${kind}-v1`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSurfaceNoise: { value: noise }, uSurfaceTime: time, uSurfaceWind: wind,
      uSurfaceSoil: { value: palette.soil }, uSurfaceMoss: { value: palette.moss },
      uSurfaceStone: { value: palette.stone }, uSurfaceHaze: { value: new THREE.Color("#536b70") },
    });
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `
      #include <common>
      varying vec3 vSurfacePosition;
      varying float vSurfaceHeight;
      uniform float uSurfaceTime;
      uniform float uSurfaceWind;
    `);
    if (kind === "grass" || kind === "flower") {
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vec3 rootPosition = vec3(0.0);
        #ifdef USE_INSTANCING
          rootPosition = instanceMatrix[3].xyz;
        #endif
        float phase = rootPosition.x * 0.45 + rootPosition.z * 0.32;
        float bend = pow(max(position.y, 0.0), 2.0) * uSurfaceWind;
        float gust = sin(uSurfaceTime * 1.3 + phase) + sin(uSurfaceTime * 0.7 + phase * 2.3) * 0.35;
        transformed.x += gust * bend * 0.13;
        transformed.z += cos(uSurfaceTime * 0.9 + phase) * bend * 0.06;
      `);
    }
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
      #include <project_vertex>
      vec4 surfacePosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        surfacePosition = instanceMatrix * surfacePosition;
      #endif
      vSurfacePosition = (modelMatrix * surfacePosition).xyz;
      vSurfaceHeight = position.y;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
      #include <common>
      varying vec3 vSurfacePosition;
      varying float vSurfaceHeight;
      uniform sampler2D uSurfaceNoise;
      uniform float uSurfaceTime;
      uniform vec3 uSurfaceSoil;
      uniform vec3 uSurfaceMoss;
      uniform vec3 uSurfaceStone;
      uniform vec3 uSurfaceHaze;
    `);
    if (kind === "terrain") {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        vec2 groundUv = vSurfacePosition.xz;
        float patches = texture2D(uSurfaceNoise, groundUv * 0.008).r;
        float detail = texture2D(uSurfaceNoise, groundUv * 0.19).g;
        float grain = texture2D(uSurfaceNoise, groundUv * 1.8).b;
        vec3 faceNormal = normalize(cross(dFdx(vSurfacePosition), dFdy(vSurfacePosition)));
        float slope = 1.0 - abs(faceNormal.y);
        float moss = smoothstep(0.35, 0.65, patches) * (1.0 - smoothstep(0.12, 0.55, slope));
        vec3 groundColor = mix(uSurfaceSoil, uSurfaceMoss, moss * 0.8);
        groundColor = mix(groundColor, uSurfaceStone, smoothstep(0.15, 0.6, slope) * 0.7);
        float path = 1.0 - smoothstep(0.45, 1.0, abs(groundUv.x - sin(groundUv.y * 0.35) * 0.6));
        path *= 1.0 - smoothstep(3.0, 14.0, abs(groundUv.y));
        float clearing = 1.0 - smoothstep(1.1, 2.9, length(groundUv));
        groundColor = mix(groundColor, uSurfaceStone * vec3(0.87, 0.83, 0.7), max(path * 0.5, clearing * 0.65));
        diffuseColor.rgb = groundColor * (0.85 + detail * 0.22 + grain * 0.12);
      `);
    } else {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        float surfaceGrain = texture2D(uSurfaceNoise, vSurfacePosition.xz * 0.4).g;
        diffuseColor.rgb *= 0.85 + surfaceGrain * 0.3;
        ${kind === "grass" ? "diffuseColor.rgb *= mix(vec3(0.42, 0.55, 0.38), vec3(1.15, 1.1, 0.85), smoothstep(0.0, 0.55, vSurfaceHeight));" : ""}
        ${kind === "stone" || kind === "crystal" ? "diffuseColor.rgb *= 0.92 + sin(vSurfacePosition.y * 18.0 + surfaceGrain * 3.0) * 0.08;" : ""}
      `);
    }
    if (kind === "flower") {
      shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `
        #include <emissivemap_fragment>
        float lantern = 1.0 - smoothstep(0.74, 1.02, vSurfaceHeight);
        totalEmissiveRadiance *= lantern * (0.8 + sin(uSurfaceTime * 0.8 + vSurfacePosition.x * 0.7) * 0.18);
      `);
    }
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      float mistDistance = length(vSurfacePosition.xz - cameraPosition.xz);
      float groundMist = (1.0 - exp(-max(mistDistance - 6.0, 0.0) * 0.025))
        * exp(-max(vSurfacePosition.y, 0.0) * 0.6);
      outgoingLight = mix(outgoingLight, uSurfaceHaze, clamp(groundMist, 0.0, 0.28));
      #include <opaque_fragment>
    `);
  };
  return material;
}

function merged(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.07, 0.18, 2.1, 6);
  trunk.translate(0, 1.05, 0);
  const branches = [trunk];
  const crowns: THREE.BufferGeometry[] = [];
  for (let branch = 0; branch < 4; branch++) {
    const angle = branch * 2.4;
    const limb = new THREE.CylinderGeometry(0.035, 0.075, 1.15, 5);
    limb.rotateZ(-0.8);
    limb.rotateY(angle);
    limb.translate(Math.cos(angle) * 0.35, 1.75 + branch * 0.12, -Math.sin(angle) * 0.35);
    branches.push(limb);
    const crown = new THREE.IcosahedronGeometry(1, 1);
    crown.scale(0.85, 0.27, 0.7);
    crown.rotateY(angle);
    crown.translate(Math.cos(angle) * 0.7, 2.12 + branch * 0.16, -Math.sin(angle) * 0.7);
    crowns.push(crown);
  }
  return { trunk: merged(branches), crown: merged(crowns) };
}

function createFlowerGeometry() {
  const stem = new THREE.CylinderGeometry(0.035, 0.065, 0.7, 5);
  stem.translate(0, 0.35, 0);
  const cap = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.69), new THREE.Vector2(0.17, 0.7),
    new THREE.Vector2(0.43, 0.79), new THREE.Vector2(0.46, 0.85),
    new THREE.Vector2(0.31, 1.01), new THREE.Vector2(0.08, 1.08), new THREE.Vector2(0, 1.09),
  ], 7);
  return { stem, cap };
}

interface InstanceBatchProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: SurfaceInstance[];
  count: number;
  color: THREE.Color;
  castShadow?: boolean;
}

function InstanceBatch({ geometry, material, instances, count, color, castShadow = false }: InstanceBatchProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const batch = mesh.current;
    if (!batch) return;
    const transform = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      transform.position.set(instance.x, instance.y, instance.z);
      transform.rotation.set(0, instance.yaw, 0);
      transform.scale.set(instance.scale * (0.85 + instance.variant * 0.3), instance.scale, instance.scale);
      transform.updateMatrix();
      batch.setMatrixAt(index, transform.matrix);
      tint.copy(color).multiplyScalar(0.8 + instance.variant * 0.35);
      batch.setColorAt(index, tint);
    }
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    batch.computeBoundingSphere();
    if (batch.boundingSphere) batch.boundingSphere.radius += 0.5;
  }, [instances, color]);
  return <instancedMesh ref={mesh} args={[geometry, material, instances.length]} count={Math.min(count, instances.length)} castShadow={castShadow} receiveShadow />;
}

const moteVertex = /* glsl */ `
  attribute float phase;
  uniform float uTime;
  uniform float uDpr;
  varying float vTwinkle;
  void main() {
    vec3 drifting = position;
    drifting.x += sin(uTime * 0.18 + phase * 30.0) * 0.35;
    drifting.y += sin(uTime * 0.3 + phase * 19.0) * 0.2;
    vec4 viewPosition = modelViewMatrix * vec4(drifting, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uDpr * 22.0 / max(-viewPosition.z, 1.0), 1.0, 5.0 * uDpr);
    vTwinkle = (0.5 + sin(uTime * 0.7 + phase * 20.0) * 0.3) * (1.0 - smoothstep(8.0, 24.0, -viewPosition.z));
  }
`;
const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vTwinkle;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.15, 1.0, radius)) * vTwinkle;
    gl_FragColor = vec4(uColor * 1.6, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function SurfaceEnvironment({ world, tier, reducedMotion }: { world: WorldSnapshot; tier: QualityTier; reducedMotion: boolean }) {
  const { gl } = useThree();
  const resources = useMemo(() => {
    const palette = surfacePalette(world.planet.primary_color, world.planet.secondary_color);
    const noise = createSurfaceNoise(world.planet.seed);
    const time = { value: 0 };
    const wind = { value: 1 };
    const tree = createTreeGeometry();
    const flower = createFlowerGeometry();
    const spire = new THREE.CylinderGeometry(0.06, 0.45, 2.7, 5, 3);
    spire.translate(0, 1.3, 0);
    const geometries = {
      terrain: createSurfaceTerrain(world.planet.seed), grass: createGrassGeometry(), rock: createStoneGeometry(),
      trunk: tree.trunk, crown: tree.crown, stem: flower.stem, cap: flower.cap, spire,
    };
    const kinds = ["terrain", "stone", "grass", "bark", "leaf", "flower", "crystal"] as const;
    const materials = Object.fromEntries(kinds.map((kind) => [kind, surfaceMaterial(palette, noise, time, wind, kind)])) as Record<typeof kinds[number], THREE.MeshStandardMaterial>;
    const instances = {
      grass: createSurfaceInstances(world.planet.seed, DENSITY.high.grass, "grass"),
      rock: createSurfaceInstances(world.planet.seed, DENSITY.high.rock, "rock"),
      flower: createSurfaceInstances(world.planet.seed, DENSITY.high.flower, "flower"),
      tree: createSurfaceInstances(world.planet.seed, DENSITY.high.tree, "tree"),
      spire: createSurfaceInstances(world.planet.seed, DENSITY.high.spire, "spire"),
    };
    const moteGeometry = new THREE.BufferGeometry();
    const random = surfaceRandom(world.planet.seed + 997);
    const positions = new Float32Array(DENSITY.high.motes * 3);
    const phases = new Float32Array(DENSITY.high.motes);
    for (let index = 0; index < phases.length; index++) {
      positions[index * 3] = (random() - 0.5) * 24;
      positions[index * 3 + 1] = 0.3 + random() * 2.7;
      positions[index * 3 + 2] = -random() * 18;
      phases[index] = random();
    }
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    moteGeometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    moteGeometry.computeBoundingSphere();
    if (moteGeometry.boundingSphere) moteGeometry.boundingSphere.radius += 0.5;
    const moteMaterial = new THREE.ShaderMaterial({
      vertexShader: moteVertex, fragmentShader: moteFragment,
      uniforms: { uTime: time, uDpr: { value: 1 }, uColor: { value: palette.glow } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    return { palette, noise, time, wind, geometries, materials, instances, moteGeometry, moteMaterial };
  }, [world.planet.seed, world.planet.primary_color, world.planet.secondary_color]);
  const { palette, geometries, materials, instances } = resources;
  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  const density = DENSITY[tier];

  useEffect(() => () => {
    resources.noise.dispose();
    for (const geometry of Object.values(resources.geometries)) geometry.dispose();
    for (const material of Object.values(resources.materials)) material.dispose();
    resources.moteGeometry.dispose();
    resources.moteMaterial.dispose();
  }, [resources]);

  useLayoutEffect(() => {
    resources.wind.value = reducedMotion ? 0 : 1;
    resources.moteGeometry.setDrawRange(0, density.motes);
    if (reducedMotion) resources.time.value = 0;
  }, [resources, reducedMotion, density.motes]);

  useFrame(({ clock }) => {
    if (!reducedMotion) resources.time.value = clock.elapsedTime;
    resources.moteMaterial.uniforms.uDpr.value = gl.getPixelRatio();
  });

  return (
    <group dispose={null}>
      <mesh geometry={geometries.terrain} material={materials.terrain} receiveShadow />
      <InstanceBatch geometry={geometries.rock} material={materials.stone} instances={instances.rock} count={density.rock} color={white} castShadow />
      <InstanceBatch geometry={geometries.grass} material={materials.grass} instances={instances.grass} count={density.grass} color={white} />
      <InstanceBatch geometry={geometries.trunk} material={materials.bark} instances={instances.tree} count={density.tree} color={white} castShadow />
      <InstanceBatch geometry={geometries.crown} material={materials.leaf} instances={instances.tree} count={density.tree} color={white} castShadow />
      <InstanceBatch geometry={geometries.stem} material={materials.bark} instances={instances.flower} count={density.flower} color={white} />
      <InstanceBatch geometry={geometries.cap} material={materials.flower} instances={instances.flower} count={density.flower} color={white} />
      <InstanceBatch geometry={geometries.spire} material={materials.crystal} instances={instances.spire} count={density.spire} color={white} castShadow />
      <points geometry={resources.moteGeometry} material={resources.moteMaterial} />
      <pointLight position={[-3, 2.5, -3]} color={palette.glow} intensity={1.2} distance={7} decay={2} />
    </group>
  );
}