"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { Galaxy } from "@/three/objects/Galaxy";
import { BlackHole } from "@/three/objects/BlackHole";
import { NeutronStar } from "@/three/objects/NeutronStar";
import { CentralSymbolObject } from "@/three/objects/CentralSymbolObject";
import { Lensing } from "@/three/effects/Lensing";
import { SurfaceCreature, type CreatureController } from "@/three/objects/SurfaceCreature";
import { SurfaceEnvironment } from "@/three/scene/SurfaceEnvironment";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { surfacePalette } from "@/three/scene/surfaceLandscape";
import { usePerfStore } from "@/store/perfStore";
import type { BehaviorStateName } from "@/three/creature/behavior";
import type { WorldSnapshot } from "@/lib/worldStore";

export type LandingStage = "approach" | "descent" | "surface";
export const STAGE_SECONDS = { approach: 2.2, descent: 1.4 } as const;

const ease = (x: number) => 1 - (1 - x) ** 3;

/** The owner's personal sky object, drawn with the same renderers as the reveal page. */
function OwnerSky({ world, pointScale }: { world: WorldSnapshot; pointScale: number }) {
  const { sky, scene } = world;
  const props = { primaryColor: sky.primary_color, secondaryColor: sky.secondary_color, rotationSpeed: scene.rotation_speed * 0.5 };
  const symbol = scene.central_symbol !== "none" ? (
    <CentralSymbolObject symbol={scene.central_symbol} primaryColor={sky.primary_color} secondaryColor={sky.secondary_color} scale={2.2} />
  ) : null;
  switch (sky.celestial_type) {
    case "galaxy":
      return <Galaxy {...props} particleDensity={scene.particle_density} pointScale={pointScale}>{symbol}</Galaxy>;
    case "black_hole":
      return <BlackHole {...props} pointScale={pointScale} config={sky.celestial_config?.celestial_type === "black_hole" ? sky.celestial_config.black_hole : undefined}>{symbol}</BlackHole>;
    case "neutron_star":
      return <NeutronStar {...props}>{symbol}</NeutronStar>;
  }
}

const atmosphereVertex = /* glsl */ `
varying vec3 vNormal; varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const atmosphereFragment = /* glsl */ `
uniform vec3 uColor; varying vec3 vNormal; varying vec3 vView;
void main() { float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.5); gl_FragColor = vec4(uColor * f * 1.6, f); }`;

function Planet({ world }: { world: WorldSnapshot }) {
  const mesh = useRef<THREE.Mesh>(null);
  const atmosphere = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment,
    uniforms: { uColor: { value: new THREE.Color(world.planet.secondary_color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  }), [world.planet.secondary_color]);
  useFrame((_, delta) => { if (mesh.current) mesh.current.rotation.y += delta * 0.05; });
  return (
    <group>
      <mesh ref={mesh}>
        <sphereGeometry args={[3, 64, 48]} />
        <meshStandardMaterial color={world.planet.primary_color} emissive={world.planet.secondary_color} emissiveIntensity={0.12} roughness={0.9} />
      </mesh>
      <mesh scale={1.08} material={atmosphere}>
        <sphereGeometry args={[3, 48, 32]} />
      </mesh>
    </group>
  );
}

/** Drives the camera through approach → descent, then hands over to limited orbit on the surface. */
function LandingCamera({ stage, stageStart }: { stage: LandingStage; stageStart: React.RefObject<number> }) {
  const { camera, clock } = useThree();
  useFrame(() => {
    if (stage === "surface") return;
    const elapsed = clock.elapsedTime - stageStart.current;
    if (stage === "approach") {
      const p = ease(Math.min(1, elapsed / STAGE_SECONDS.approach));
      camera.position.set(0, THREE.MathUtils.lerp(4, 1.2, p), THREE.MathUtils.lerp(36, 7.5, p));
      camera.lookAt(0, 0, 0);
    } else {
      const p = ease(Math.min(1, elapsed / STAGE_SECONDS.descent));
      camera.position.set(0, THREE.MathUtils.lerp(1.2, 2.6, p), THREE.MathUtils.lerp(7.5, 3.05, p));
      camera.lookAt(0, 3 * p, 0);
    }
  });
  return null;
}

interface LandingSceneProps {
  world: WorldSnapshot;
  stage: LandingStage;
  stageStart: React.RefObject<number>;
  reducedMotion: boolean;
  active: boolean;
  quiet: boolean;
  controller: React.RefObject<CreatureController | null>;
  onCreatureState: (state: BehaviorStateName, reaction?: string) => void;
}

export function LandingScene({ world, stage, stageStart, reducedMotion, active, quiet, controller, onCreatureState }: LandingSceneProps) {
  const { camera, scene } = useThree();
  const tier = usePerfStore((state) => state.tier);
  const palette = useMemo(() => surfacePalette(world.planet.primary_color, world.planet.secondary_color), [world.planet.primary_color, world.planet.secondary_color]);
  const diagnostics = useMemo(() => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    return {
      bloom: params.get("bloom") !== "off",
      stars: params.get("stars") !== "off",
      approachEffects: params.get("approachEffects") === "on",
    };
  }, []);
  // Wide screens have the room to look higher and show the whole sky galaxy.
  const wide = useThree((state) => state.size.width > state.size.height * 1.2);
  const lookY = wide ? 1.05 : 0.75;
  // Black holes and neutron stars are ~3x smaller than the galaxy mesh, so they need a boost to read like the reveal.
  const boost = world.sky.celestial_type === "galaxy" ? 1 : 2.4;
  const skyPosition: [number, number, number] = wide ? [0, 5.9, -18] : [0, 4.3, -18];
  const surface = stage === "surface";
  const skyScale = surface ? wide ? 1 : 0.65 : 5;
  const blackHoleConfig = world.sky.celestial_config?.celestial_type === "black_hole" ? world.sky.celestial_config.black_hole : undefined;
  const fogColor = palette.haze;

  // EffectComposer rebuilds (and recompiles) its passes whenever its children change identity, so keep them stable across re-renders.
  const isBlackHole = world.sky.celestial_type === "black_hole";
  const lensStrength = surface ? blackHoleConfig?.lens_strength ?? 1 : 0;
  const effects = useMemo(() => (
    <>
      {diagnostics.bloom ? <Bloom intensity={0.45} luminanceThreshold={0.85} luminanceSmoothing={0.15} mipmapBlur /> : <></>}
      {isBlackHole ? <Lensing strength={lensStrength} radius={0.42} anchorPosition={surface ? (wide ? [0, 5.9, -18] : [0, 4.3, -18]) : [0, 8, -40]} /> : <></>}
    </>
  ), [diagnostics.bloom, isBlackHole, lensStrength, surface, wide]);

  useEffect(() => {
    scene.fog = stage === "surface" ? new THREE.Fog(fogColor, 14, 48) : null;
    return () => { scene.fog = null; };
  }, [stage, scene, fogColor]);

  useEffect(() => {
    if (stage === "surface") {
      camera.position.set(0, wide ? 1.65 : 1.45, wide ? 4.8 : 4.7);
      camera.lookAt(0, lookY, 0);
    }
  }, [stage, camera, wide, lookY]);

  return (
    <>
      <color attach="background" args={[stage === "surface" ? fogColor.getStyle() : "#03030a"]} />
      {diagnostics.stars && <Stars radius={80} depth={40} count={tier === "low" || reducedMotion ? 1000 : 2200} factor={2} fade speed={reducedMotion ? 0 : 0.2} />}
      <ambientLight intensity={0.12} />
      <hemisphereLight args={["#b6d0de", "#4b5540", 1.05]} />
      <directionalLight
        position={[-5, 9, 4]} color="#ffe2b4" intensity={2.1} castShadow
        shadow-mapSize-width={tier === "low" ? 512 : 1024}
        shadow-mapSize-height={tier === "low" ? 512 : 1024}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={8} shadow-camera-bottom={-8}
        shadow-camera-near={0.5} shadow-camera-far={28}
        shadow-bias={-0.0003} shadow-normalBias={0.035}
      />
      <directionalLight position={[4, 4, -6]} color="#9dd4db" intensity={0.55} />
      <LandingCamera stage={stage} stageStart={stageStart} />
      <RenderPerformanceMetrics adapt={surface && active && !reducedMotion} />

      {/* One sky for every stage: remounting it re-uploads its textures and pops in as a flicker. */}
      <group
        position={surface ? skyPosition : [0, 8, -40]}
        rotation={surface ? [wide ? 0.2 : 0.14, 0, 0] : [0, 0, 0]}
        scale={skyScale * boost}
      >
        <Suspense fallback={null}><OwnerSky world={world} pointScale={skyScale * boost} /></Suspense>
      </group>

      {stage !== "surface" ? (
        <Planet world={world} />
      ) : (
        <>
          <SurfaceEnvironment world={world} tier={tier} reducedMotion={reducedMotion} />
          <Suspense fallback={null}>
            <SurfaceCreature
              spec={world.creature}
              primaryColor={world.planet.primary_color}
              energy={world.creature.traits.energy}
              quiet={quiet}
              seed={world.planet.seed}
              reducedMotion={reducedMotion}
              controller={controller}
              onStateChange={onCreatureState}
            />
          </Suspense>
          <OrbitControls
            target={[0, lookY, 0]}
            enablePan={false}
            minDistance={2.8}
            maxDistance={6}
            minPolarAngle={0.86}
            maxPolarAngle={1.48}
            minAzimuthAngle={-0.8}
            maxAzimuthAngle={0.8}
            enableDamping
          />
        </>
      )}
      {(surface || diagnostics.approachEffects) && (diagnostics.bloom || isBlackHole) && (
        <EffectComposer enableNormalPass={false}>{effects}</EffectComposer>
      )}
    </>
  );
}
