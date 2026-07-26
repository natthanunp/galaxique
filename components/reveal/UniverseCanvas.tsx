"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { UniverseScene } from "@/three/scene/UniverseScene";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { Lensing } from "@/three/effects/Lensing";
import { targetDpr, tierDprCap, tierEffectsEnabled } from "@/lib/perf";
import { usePerfStore } from "@/store/perfStore";
import type { UniverseReveal } from "@/types/universe";

interface UniverseCanvasProps {
  reveal: UniverseReveal;
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
 *  - disables the lensing pass below the "high" tier, and bloom at "low"
 *  - scales particle/segment counts in CosmicBackground/ParticleField/Galaxy
 */
export default function UniverseCanvas({
  reveal,
  onCanvasReady,
}: UniverseCanvasProps) {
  const tier = usePerfStore((s) => s.tier);
  const upgrade = usePerfStore((s) => s.upgrade);
  const downgrade = usePerfStore((s) => s.downgrade);
  const { bloom, lensing } = tierEffectsEnabled(tier);
  const showLensing = lensing && reveal.celestial_type === "black_hole";
  const blackHoleConfig = reveal.celestial_config?.celestial_type === "black_hole"
    ? reveal.celestial_config.black_hole
    : undefined;
  const showEffects = bloom || showLensing;

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
      dpr={tierDprCap(tier, targetDpr())}
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

      {showEffects && (
        <EffectComposer enableNormalPass={false}>
          {bloom ? (
            showLensing ? (
              <>
                <Bloom intensity={0.32} luminanceThreshold={1.1} luminanceSmoothing={0.15} mipmapBlur />
                <Lensing strength={blackHoleConfig?.lens_strength ?? 1} radius={0.42} />
              </>
            ) : (
              <Bloom intensity={0.32} luminanceThreshold={1.1} luminanceSmoothing={0.15} mipmapBlur />
            )
          ) : (
            <Lensing strength={blackHoleConfig?.lens_strength ?? 1} radius={0.42} />
          )}
        </EffectComposer>
      )}
    </Canvas>
  );
}

