"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import * as THREE from "three";

import { UniverseScene } from "@/three/scene/UniverseScene";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { Lensing } from "@/three/effects/Lensing";
import { targetDpr, tierDprCap } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";
import type { UniverseReveal, Vibe } from "@/types/universe";

interface UniverseCanvasProps {
  reveal: UniverseReveal;
  /** Called once R3F mounts its <canvas> — used to grab it for video recording. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

/** Vibe-driven postprocessing parameters. Controls bloom intensity/threshold
 *  and a subtle color tint overlay that makes each vibe feel distinct at a
 *  glance, even when the LLM picks similar primary/secondary colors. */
interface VibePostFX {
  bloomIntensity: number;
  bloomThreshold: number;
  /** Subtle full-screen color tint (additive blend). */
  tint: string;
  tintOpacity: number;
}

const VIBE_POSTFX: Record<Vibe, VibePostFX> = {
  cute: {
    bloomIntensity: 0.45,
    bloomThreshold: 0.9,
    tint: "#ff9ec4",
    tintOpacity: 0.04,
  },
  cozy: {
    bloomIntensity: 0.38,
    bloomThreshold: 1.0,
    tint: "#ffb870",
    tintOpacity: 0.035,
  },
  mysterious: {
    bloomIntensity: 0.35,
    bloomThreshold: 1.1,
    tint: "#6a3d9d",
    tintOpacity: 0.05,
  },
  intense: {
    bloomIntensity: 0.55,
    bloomThreshold: 0.8,
    tint: "#ff4444",
    tintOpacity: 0.03,
  },
  whimsical: {
    bloomIntensity: 0.42,
    bloomThreshold: 0.95,
    tint: "#a8e6cf",
    tintOpacity: 0.04,
  },
  cynical: {
    bloomIntensity: 0.2,
    bloomThreshold: 1.4,
    tint: "#708090",
    tintOpacity: 0.06,
  },
};

/**
 * The R3F canvas wrapper. Dynamically imported with ssr:false by the parent
 * (Three.js needs the DOM). Renders the full universe scene with auto-rotating
 * orbit controls, a dark background, and an adaptive postprocessing stack
 * (bloom + an optional black-hole-only gravitational-lensing warp).
 *
 * <PerformanceMonitor> measures live frame times and steps the shared
 * `usePerfStore` quality tier up/down, which in turn:
 *  - caps `dpr` further on top of the device-based `targetDpr()`
 *  - scales particle/segment counts in CosmicBackground/ParticleField/Galaxy
 *
 * Bloom and lensing are always-on (see lib/perf.ts's tierEffectsEnabled) so
 * the first paint is the best-looking frame, not the worst. The live monitor
 * only intervenes if measured FPS drops below 30 for two consecutive samples.
 */
export default function UniverseCanvas({
  reveal,
  onCanvasReady,
}: UniverseCanvasProps) {
  const tier = usePerfStore((s) => s.tier);
  const upgrade = usePerfStore((s) => s.upgrade);
  const downgrade = usePerfStore((s) => s.downgrade);
  // Lensing is the defining visual of a black-hole result. It is a single
  // UV warp with no additional scene pass, so it should not wait for the
  // adaptive monitor to promote a mobile viewport from medium to high.
  const showLensing = reveal.celestial_type === "black_hole";
  const blackHoleConfig = reveal.celestial_config?.celestial_type === "black_hole"
    ? reveal.celestial_config.black_hole
    : undefined;

  // Vibe-driven postprocessing
  const postfx = VIBE_POSTFX[reveal.vibe];

  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 55 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true, // needed for canvas.captureStream / screenshots
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      onCreated={({ gl }) => {
        // Transparent clear color lets the page background show through
        // (we want the R3F canvas to be the immersive background, not a
        // bordered card over a different fill). The page's deep space
        // base color is set via the Tailwind `bg-background` on the
        // <main> so we never see a flash of white during initial paint.
        gl.setClearColor(new THREE.Color("#05050a"), 0);
        const canvas = gl.domElement;
        onCanvasReady?.(canvas);
      }}
      dpr={tierDprCap(tier, targetDpr())}
    >
      <PerformanceMonitor onIncline={upgrade} onDecline={downgrade} />
      <RenderPerformanceMetrics />

      <ambientLight intensity={0.55} />
      <pointLight position={[8, 6, 8]} intensity={1.2} />
      <pointLight position={[-8, -4, -6]} intensity={0.6} color={reveal.secondary_color} />

      <UniverseScene reveal={reveal} />
      {postfx.tintOpacity > 0 ? <TintOverlay color={postfx.tint} opacity={postfx.tintOpacity} /> : null}

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={4}
        maxDistance={16}
        autoRotate
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
      />

      <EffectComposer enableNormalPass={false}>
        <Bloom
          intensity={postfx.bloomIntensity}
          luminanceThreshold={postfx.bloomThreshold}
          luminanceSmoothing={0.15}
          mipmapBlur
        />
        {showLensing ? (
          <Lensing strength={blackHoleConfig?.lens_strength ?? 1} radius={0.42} />
        ) : (
          <></>
        )}
      </EffectComposer>
    </Canvas>
  );
}

/** A camera-attached full-screen quad that adds a subtle vibe-tinted wash
 *  over the entire scene. Uses additive blending at a low opacity so it
 *  never washes out the bloom highlights — it just shifts the scene's
 *  overall color toward the vibe's signature tint. The overlay is parented
 *  to the camera and re-aimed every frame so the quad always faces the
 *  camera regardless of orbit-drag angle. */
function TintOverlay({ color, opacity }: { color: string; opacity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const tint = useMemo(() => new THREE.Color(color), [color]);
  useFrame(() => {
    if (!meshRef.current) return;
    // Keep the quad anchored to the camera so the tint fills the viewport
    // at all orbit angles. World-space placement would leave the edges of
    // the screen untinted whenever the camera moves off-axis.
    meshRef.current.position.copy(camera.position);
    meshRef.current.quaternion.copy(camera.quaternion);
    // Sit the quad a hair in front of the near plane so the depth test
    // never clips it.
    meshRef.current.translateZ(-1.5);
  });
  return (
    <mesh ref={meshRef} renderOrder={999}>
      <planeGeometry args={[40, 22]} />
      <meshBasicMaterial
        color={tint}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

