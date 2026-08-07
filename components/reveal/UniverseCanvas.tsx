"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { UniverseScene } from "@/three/scene/UniverseScene";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { Lensing } from "@/three/effects/Lensing";
import { targetDpr } from "@/lib/perf";
import type { UniverseReveal, Vibe } from "@/types/universe";

interface UniverseCanvasProps {
  reveal: UniverseReveal;
  /** Called once R3F mounts its <canvas> — used to grab it for video recording. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

/** Vibe-driven postprocessing parameters. Controls bloom intensity/threshold
 *  and a subtle color tint overlay that makes each vibe feel distinct at a
 *  glance, even when the LLM picks similar primary/secondary colors. Bloom
 *  is intentionally moderate — the 3D scene is a backdrop that frames the
 *  centered vinyl disc hero, so it should glow softly rather than wash out
 *  the disc with a flat sheet of light. */
interface VibePostFX {
  bloomIntensity: number;
  bloomThreshold: number;
  /** Subtle full-screen color tint (additive blend). */
  tint: string;
  tintOpacity: number;
}

const VIBE_POSTFX: Record<Vibe, VibePostFX> = {
  cute: {
    bloomIntensity: 0.55,
    bloomThreshold: 0.85,
    tint: "#ff9ec4",
    tintOpacity: 0.04,
  },
  cozy: {
    bloomIntensity: 0.5,
    bloomThreshold: 0.9,
    tint: "#ffb870",
    tintOpacity: 0.035,
  },
  mysterious: {
    bloomIntensity: 0.6,
    bloomThreshold: 0.9,
    tint: "#6a3d9d",
    tintOpacity: 0.05,
  },
  intense: {
    bloomIntensity: 0.7,
    bloomThreshold: 0.8,
    tint: "#ff4444",
    tintOpacity: 0.03,
  },
  whimsical: {
    bloomIntensity: 0.55,
    bloomThreshold: 0.85,
    tint: "#a8e6cf",
    tintOpacity: 0.04,
  },
  cynical: {
    bloomIntensity: 0.4,
    bloomThreshold: 1.0,
    tint: "#708090",
    tintOpacity: 0.05,
  },
};

/**
 * The R3F canvas wrapper. Dynamically imported with ssr:false by the parent
 * (Three.js needs the DOM). Renders the full universe scene with auto-rotating
 * orbit controls, a dark background, and a high-quality postprocessing stack
 * (bloom + an optional black-hole-only lensing warp) at a consistent high
 * visual tier for the full reveal.
 */
export default function UniverseCanvas({
  reveal,
  onCanvasReady,
}: UniverseCanvasProps) {
  // Lensing is the defining visual of a black-hole result. It is a single
  // UV warp with no additional scene pass, so it should not wait for the
  // adaptive monitor to promote a mobile viewport from medium to high.
  const showLensing = reveal.celestial_type === "black_hole";
  const blackHoleConfig = reveal.celestial_config?.celestial_type === "black_hole"
    ? reveal.celestial_config.black_hole
    : undefined;

  // Vibe-driven postprocessing
  const postfx = VIBE_POSTFX[reveal.vibe];

  // Mobile viewports are narrow + tall, so the fixed 55° fov + 4-unit
  // minDistance can put the camera so close to the central object (esp.
  // black-hole event horizon) that the image looks like a giant distorted
  // blob filling the screen. Pull the camera back on narrow viewports
  // and tighten the zoom-in limit so pinch-zoom can never recreate the
  // same problem.
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 720,
  }));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isNarrow = viewport.width < 640;
  const isShort = viewport.height < 500;
  const isWide = viewport.width >= 1024;
  const isUltraWide = viewport.width >= 1600;
  // On mobile the galaxy already auto-rotates, so it stays alive without
  // manual orbit. Disabling drag-to-orbit on narrow viewports lets a
  // single-finger swipe scroll the PAGE (the reading sits below the fold),
  // which is the natural mobile gesture. Without this, OrbitControls sets
  // `touch-action: none` on the canvas and swallows every swipe, so users
  // get stuck unable to scroll down to the reading. Desktop keeps
  // drag-to-orbit since there's no scroll conflict there (wheel scrolls).
  const enableOrbit = !isNarrow;
  // The vinyl disc is a DOM element pinned to the viewport center. The
  // 3D galaxy needs to render AROUND it, not behind it — so the camera
  // sits well back from the origin and the central object's silhouette
  // extends well past the disc's screen footprint. We pull back further
  // on every breakpoint than the previous tuning, especially on
  // short-tall phones (where the disc's vmin size eats a huge chunk of
  // the visible canvas).
  const extraBack = isNarrow
    ? isShort
      ? 15
      : 14
    : isUltraWide
      ? 7
      : isWide
        ? 5
        : 3;
  // Narrower FOV on wider screens reduces perspective stretching and
  // keeps the galaxy/black hole circular. Phones keep a slightly wider
  // FOV so the scene doesn't feel too far away.
  const fov = isNarrow ? 55 : isUltraWide ? 45 : isWide ? 48 : 52;
  // Camera pulled back so the full 3D galaxy is visible *around* the
  // centered vinyl disc. The disc is a smaller DOM element pinned to
  // the viewport center (see components/reveal/VinylDisc.tsx); a
  // wider camera distance keeps the galaxy arms sweeping in from
  // beyond the disc's edge rather than getting hidden behind it.
  const cameraPos: [number, number, number] = [0, 0, 9 + extraBack];
  const minDist = isNarrow ? 6 : isWide ? 7 : 5;
  const maxDist = isNarrow ? 24 : isWide ? 28 : 22;

  return (
    <Canvas
      camera={{ position: cameraPos, fov }}
      // On mobile the canvas must not capture touches at all — otherwise
      // OrbitControls' `touch-action: none` swallows every swipe and the
      // page can't scroll to the reading. `pointer-events: none` lets
      // touches fall through to the page (which scrolls), while the
      // galaxy keeps auto-rotating. Desktop keeps the canvas interactive
      // for drag-to-orbit.
      style={isNarrow ? { pointerEvents: "none" } : undefined}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true, // needed for canvas.captureStream / screenshots
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      onCreated={({ gl }) => {
        // Keep the canvas opaque so its deep-space base remains visible
        // behind the scrolling reading rather than exposing the page fill.
        gl.setClearColor(new THREE.Color("#05050a"), 1);
        const canvas = gl.domElement;
        onCanvasReady?.(canvas);
      }}
      dpr={targetDpr()}
    >
      <RenderPerformanceMetrics />

      <ambientLight intensity={0.85} />
      <pointLight position={[8, 6, 8]} intensity={2.2} />
      <pointLight position={[-8, -4, -6]} intensity={1.4} color={reveal.secondary_color} />

      <UniverseScene reveal={reveal} />
      {postfx.tintOpacity > 0 ? <TintOverlay color={postfx.tint} opacity={postfx.tintOpacity} /> : null}

      <OrbitControls
        enablePan={false}
        enableRotate={enableOrbit}
        enableZoom={!isNarrow}
        minDistance={minDist}
        maxDistance={maxDist}
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

