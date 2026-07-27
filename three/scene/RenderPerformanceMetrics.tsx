"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { usePerfStore } from "@/store/perfStore";

const SAMPLE_INTERVAL_SECONDS = 1;
// Below 30fps is genuinely painful to look at; that's the only case where
// we force a tier downgrade. (The 45fps threshold used here before was
// too aggressive — it downgraded "high" -> "medium" on perfectly-smooth
// 50fps mobile devices and produced the "low quality at first" UX.)
const MIN_SUSTAINED_FPS = 30;

export function RenderPerformanceMetrics() {
  const { gl, size } = useThree();
  const elapsedRef = useRef(0);
  const framesRef = useRef(0);
  const lowFpsStreakRef = useRef(0);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    framesRef.current += 1;
    if (elapsedRef.current < SAMPLE_INTERVAL_SECONDS) return;

    const seconds = elapsedRef.current;
    const fps = framesRef.current / seconds;
    const metrics = {
      fps: Math.round(fps),
      frameTimeMs: (seconds / framesRef.current) * 1_000,
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
      lowFpsStreakRef.current += 1;
      if (lowFpsStreakRef.current >= 2) store.downgrade();
    } else {
      lowFpsStreakRef.current = 0;
    }
    elapsedRef.current = 0;
    framesRef.current = 0;
  });

  return null;
}