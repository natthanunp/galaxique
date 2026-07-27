"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { UniverseScene } from "@/three/scene/UniverseScene";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { Lensing } from "@/three/effects/Lensing";
import { targetDpr, tierDprCap } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";
import type { UniverseReveal } from "@/types/universe";

interface UniverseCanvasProps {
  reveal: UniverseReveal;
  captureQuality?: boolean;
  /** Called once R3F mounts its <canvas> — used to grab it for video recording. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

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
  captureQuality = false,
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
        gl.setClearColor(new THREE.Color("#05050a"), 1);
        const canvas = gl.domElement;
        onCanvasReady?.(canvas);
      }}
      dpr={captureQuality ? 2 : tierDprCap(tier, targetDpr())}
    >
      <PerformanceMonitor onIncline={upgrade} onDecline={downgrade} />
      <RenderPerformanceMetrics />

      <ambientLight intensity={0.55} />
      <pointLight position={[8, 6, 8]} intensity={1.2} />
      <pointLight position={[-8, -4, -6]} intensity={0.6} color={reveal.secondary_color} />

      <UniverseScene reveal={reveal} />

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
        <Bloom intensity={0.32} luminanceThreshold={1.1} luminanceSmoothing={0.15} mipmapBlur />
        {showLensing && (
          <Lensing strength={blackHoleConfig?.lens_strength ?? 1} radius={0.42} />
        )}
      </EffectComposer>
    </Canvas>
  );
}

