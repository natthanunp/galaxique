"use client";

import type { ProfileMetadata } from "@/lib/profile";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { UniverseScene } from "@/three/scene/UniverseScene";
import { registerFrameCapture } from "@/three/hooks/captureUniverseFrame";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { Lensing } from "@/three/effects/Lensing";
import { usePerfStore } from "@/store/perfStore";
import { useSceneActivity } from "@/lib/useSceneActivity";
import { targetDpr, tierDprCap } from "@/lib/perf";
import type { UniverseReveal, Vibe } from "@/types/universe";

const EXPORT_DPR = 2;

interface UniverseCanvasProps {
  reveal: UniverseReveal;
  /** Called once R3F mounts its <canvas> — used to grab it for video recording. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** When true, sets the renderer DPR to a crisp-but-fast 2.0 for exports.
   *  Set this before recording and clear it after. */
  exportMode?: boolean;
  /** Static metadata rendered into the direct WebGL recording as a texture. */
  exportOverlay?: ExportOverlayInfo | null;
}

export interface ExportOverlayInfo extends ProfileMetadata {
  albumArtUrl: string | null;
  trackName: string;
  artist: string;
  reading: string;
  vibe: string;
  language: "en" | "th";
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
  exportMode,
  exportOverlay,
}: UniverseCanvasProps) {
  const tier = usePerfStore(s => s.tier);
  const active = useSceneActivity();
  useEffect(() => { usePerfStore.getState().initialize(); }, []);
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
  // On mobile the galaxy already auto-rotates, so it stays alive without
  // manual orbit. Disabling drag-to-orbit on narrow viewports lets a
  // single-finger swipe scroll the PAGE (the reading sits below the fold),
  // which is the natural mobile gesture. Without this, OrbitControls sets
  // `touch-action: none` on the canvas and swallows every swipe, so users
  // get stuck unable to scroll down to the reading. Desktop keeps
  // drag-to-orbit since there's no scroll conflict there (wheel scrolls).
  const enableOrbit = !isNarrow;
  // Fit the scene to the shorter canvas dimension. Extra width or height
  // reveals more space instead of enlarging the galaxy beyond the frame.
  const cameraPos: [number, number, number] = [0, 0, 14];
  const minDist = isNarrow ? 8 : 9;
  const maxDist = isNarrow ? 22 : 24;

  return (
    <Canvas
      frameloop={exportMode || active ? "always" : "demand"}
      camera={{ position: cameraPos, fov: 55 }}
      // On mobile the canvas must not capture touches at all — otherwise
      // OrbitControls' `touch-action: none` swallows every swipe and the
      // page can't scroll to the reading. `pointer-events: none` lets
      // touches fall through to the page (which scrolls), while the
      // galaxy keeps auto-rotating. Desktop keeps the canvas interactive
      // for drag-to-orbit.
      style={
        exportMode
          ? { width: "100%", height: "100%", pointerEvents: "none" }
          : isNarrow
            ? { pointerEvents: "none" }
            : undefined
      }
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        // Export captures this canvas into a MediaStream and composites the
        // resulting video, so retaining each WebGL backbuffer is unnecessary
        // (and can force a costly GPU sync on mobile).
        preserveDrawingBuffer: false,
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      onCreated={({ gl }) => {
        // Keep the canvas opaque so its deep-space base remains visible
        // behind the scrolling reading rather than exposing the page fill.
        gl.setClearColor(new THREE.Color("#05050a"), 1);
        const canvas = gl.domElement;
        onCanvasReady?.(canvas);
      }}
      // This must be a Canvas prop, not gl.setPixelRatio() in an effect:
      // R3F resizes the drawing buffer in response to `dpr`, while changing
      // the renderer setting alone leaves captureStream at CSS resolution.
      dpr={exportMode ? EXPORT_DPR : tierDprCap(tier, targetDpr())}
    >
      <FrameCapture />
      <ExportFrameMetrics active={Boolean(exportMode)} />
      <RenderPerformanceMetrics adapt={!exportMode && active} />
      <ResponsiveCamera />

      <ambientLight intensity={0.32} />
      <directionalLight position={[6, 8, 7]} intensity={2.0} color="#fff0db" />
      <hemisphereLight args={["#8fa8df", "#181322", 0.55]} />
      <directionalLight position={[-5, 2, -4]} intensity={1.3} color={reveal.secondary_color} />

      <UniverseScene reveal={reveal} />
      {postfx.tintOpacity > 0 ? <TintOverlay color={postfx.tint} opacity={postfx.tintOpacity * 0.25} /> : null}
      {exportOverlay ? <ExportStoryCard info={exportOverlay} /> : null}

      <OrbitControls
        enablePan={false}
        enableRotate={enableOrbit}
        enableZoom={!isNarrow}
        minDistance={minDist}
        maxDistance={maxDist}
        autoRotate={Boolean(exportMode || active)}
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
      />

      <EffectComposer enableNormalPass={false}>
        <Bloom
          intensity={postfx.bloomIntensity * 0.72}
          luminanceThreshold={postfx.bloomThreshold}
          luminanceSmoothing={0.15}
          mipmapBlur
        />
        {showLensing ? (
          <Lensing
            strength={blackHoleConfig?.lens_strength ?? 1}
            radius={0.42}
            anchorPosition={isNarrow ? [0, 4, 0] : [0, 0, 0]}
          />
        ) : (
          <></>
        )}
      </EffectComposer>
    </Canvas>
  );
}

/** Keep a 50° field of view on the shorter canvas axis: horizontal in
 * portrait, vertical in landscape. Use the actual canvas box, including
 * portrait exports, and update both projection values together before render.
 * Camera distance remains controlled by OrbitControls so resizing preserves zoom.
 */
function ResponsiveCamera() {
  useFrame(({ camera, size }) => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    if (!perspectiveCamera.isPerspectiveCamera || size.width <= 0 || size.height <= 0) return;
    const aspect = size.width / size.height;
    const targetFov =
      (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50) / 2) / Math.min(1, aspect)) *
        180) /
      Math.PI;
    if (Math.abs(perspectiveCamera.fov - targetFov) > 0.001 || perspectiveCamera.aspect !== aspect) {
      perspectiveCamera.aspect = aspect;
      perspectiveCamera.fov = targetFov;
      perspectiveCamera.updateProjectionMatrix();
    }
  });
  return null;
}

/** Runs after EffectComposer (priority 1), while the drawing buffer is valid. */
function FrameCapture() {
  const { gl, invalidate } = useThree();
  const pending = useRef<{ resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => {
    const unregister = registerFrameCapture(gl.domElement, () => new Promise((resolve, reject) => {
      pending.current?.reject(new Error("A newer frame capture replaced this request."));
      pending.current = { resolve, reject };
      invalidate();
    }));
    return () => {
      unregister();
      pending.current?.reject(new Error("The universe closed before capture."));
      pending.current = null;
    };
  }, [gl, invalidate]);
  useFrame(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    // Snapshot synchronously during this render tick; bitmap decoding is async.
    try { createImageBitmap(gl.domElement).then(request.resolve, request.reject); }
    catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
  }, 2);
  return null;
}

/** A one-time CanvasTexture card for direct WebGL video capture. Keeping this
 * in the scene preserves the song and reading information without routing the
 * video through the mobile browser's throttled 2D canvas capture path. */
function ExportStoryCard({ info }: { info: ExportOverlayInfo }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const texture = useMemo(() => createExportStoryTexture(info), [info]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    if (!meshRef.current) return;
    const distance = 1.5;
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const visibleHeight = 2 * distance * Math.tan(
      THREE.MathUtils.degToRad(perspectiveCamera.fov / 2),
    );
    meshRef.current.position.copy(camera.position);
    meshRef.current.quaternion.copy(camera.quaternion);
    meshRef.current.translateZ(-distance);
    meshRef.current.translateY(-visibleHeight * 0.22);
  });

  return (
    <mesh ref={meshRef} renderOrder={1_000}>
      <planeGeometry args={[0.82, 0.62]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function createExportStoryTexture(info: ExportOverlayInfo): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 680;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  drawExportStoryTexture(ctx, info, null);

  if (info.albumArtUrl) {
    const art = new Image();
    art.crossOrigin = "anonymous";
    art.onload = () => {
      drawExportStoryTexture(ctx, info, art);
      texture.needsUpdate = true;
    };
    art.src = info.albumArtUrl;
  }

  return texture;
}

function drawExportStoryTexture(
  ctx: CanvasRenderingContext2D,
  info: ExportOverlayInfo,
  art: HTMLImageElement | null,
): void {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const width = canvas.width;
  const height = canvas.height;
  const pad = 56;
  const radius = 38;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(8, 10, 20, 0.34)");
  gradient.addColorStop(1, "rgba(4, 5, 12, 0.92)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const vibe = info.language === "th" ? "โทนของคุณ" : "Your vibe";
  const artSize = 136;
  const artX = width - pad - artSize;
  const artY = 52;
  const textWidth = width - pad * 3 - artSize;
  ctx.fillStyle = "rgba(255,255,255,0.64)";
  ctx.font = '500 30px "Noto Sans Thai", sans-serif';
  ctx.fillText(`${vibe} · ${info.vibe}`, pad, 68);

  ctx.fillStyle = "#ffffff";
  ctx.font = '600 42px "Noto Sans Thai", sans-serif';
  ctx.fillText(truncateCanvasText(ctx, info.trackName, textWidth), pad, 132);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = '400 30px "Noto Sans Thai", sans-serif';
  ctx.fillText(truncateCanvasText(ctx, info.artist, textWidth), pad, 178);

  if (art?.complete && art.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(artX, artY, artSize, artSize, 20);
    ctx.clip();
    ctx.drawImage(art, artX, artY, artSize, artSize);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = '400 32px "Noto Sans Thai", sans-serif';
  const lines = wrapCanvasText(ctx, info.reading, width - pad * 2, info.language);
  const lineHeight = 47;
  lines.slice(0, 8).forEach((line, index) => {
    const text = index === 7 && lines.length > 8 ? `${line}...` : line;
    ctx.fillText(text, pad, 250 + index * lineHeight);
  });

}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  language: "en" | "th",
): string[] {
  const pieces = language === "th" && typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter("th", { granularity: "word" }).segment(text), ({ segment }) => segment)
    : text.split(/(\s+)/);
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces) {
    const candidate = line + piece;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line.trim());
      line = piece.trimStart();
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function truncateCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
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

/** Temporary export diagnostic. Compare this cadence with useOverlayCanvas's
 * `[export] perf` line: matching ~45ms gaps means the R3F render/present
 * path is pacing rAF; a faster R3F cadence would isolate the synchronous
 * WebGL-to-2D drawImage copy as the source of the stall. */
function ExportFrameMetrics({ active }: { active: boolean }) {
  const lastLogAt = useRef(0);
  const frameCount = useRef(0);
  const latestDeltaMs = useRef(0);

  useFrame((_, delta) => {
    if (!active) {
      lastLogAt.current = 0;
      frameCount.current = 0;
      return;
    }

    frameCount.current += 1;
    latestDeltaMs.current = delta * 1_000;
    const now = performance.now();
    if (now - lastLogAt.current < 1_000) return;

    console.log("[export] r3f", {
      framesPerSec: frameCount.current,
      frameDeltaMs: Math.round(latestDeltaMs.current),
    });
    lastLogAt.current = now;
    frameCount.current = 0;
  });

  return null;
}
