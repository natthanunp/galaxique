"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { usePerfStore } from "@/store/perfStore";

const SAMPLE_INTERVAL_SECONDS = 1;
// Two slow samples lower quality; twelve healthy samples permit recovery.
const MIN_SUSTAINED_FPS = 48;

export function RenderPerformanceMetrics({ adapt = true }: { adapt?: boolean }) {
  const { gl, size } = useThree();
  const frameTimesRef = useRef<number[]>([]);
  const elapsedRef = useRef(0);
  const framesRef = useRef(0);
  const lowFpsStreakRef = useRef(0);
  const highFpsStreakRef = useRef(0);

  useFrame((_, delta) => {
    if (!adapt || document.hidden || delta > 0.25) {
      frameTimesRef.current = [];
      elapsedRef.current = 0; framesRef.current = 0; lowFpsStreakRef.current = 0; highFpsStreakRef.current = 0; return;
    }
    frameTimesRef.current.push(delta * 1000);
    elapsedRef.current += delta;
    framesRef.current += 1;
    if (elapsedRef.current < SAMPLE_INTERVAL_SECONDS) return;

    const seconds = elapsedRef.current;
    const fps = framesRef.current / seconds;
    const sortedTimes = frameTimesRef.current.sort((a, b) => a - b);
    const metrics = {
      fps: Math.round(fps),
      frameTimeMs: (seconds / framesRef.current) * 1_000,
      p95FrameTimeMs: sortedTimes[Math.floor(sortedTimes.length * 0.95)] ?? 0,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      points: gl.info.render.points,
      dpr: gl.getPixelRatio(),
      width: size.width,
      height: size.height,
      sampledAt: performance.now(),
    };

    const store = usePerfStore.getState();
    store.recordMetrics(metrics);
    // Require two consecutive bad samples before downgrading. A single
    // 1-second dip (which happens on tab focus return, scene swap, etc.)
    // used to knock a tier off the first time it happened.
    if (fps < MIN_SUSTAINED_FPS) {
      highFpsStreakRef.current = 0;
      lowFpsStreakRef.current += 1;
      if (lowFpsStreakRef.current >= 2) store.downgrade();
    } else {
      lowFpsStreakRef.current = 0;
      highFpsStreakRef.current = fps > 57 ? highFpsStreakRef.current + 1 : 0;
      if (highFpsStreakRef.current >= 12) { store.upgrade(); highFpsStreakRef.current = 0; }
    }
    frameTimesRef.current = [];
    elapsedRef.current = 0;
    framesRef.current = 0;
  });

  return null;
}