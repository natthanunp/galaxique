"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { usePerfStore } from "@/store/perfStore";

const SAMPLE_INTERVAL_SECONDS = 1;
const MIN_SUSTAINED_FPS = 45;

export function RenderPerformanceMetrics() {
  const { gl, size } = useThree();
  const elapsedRef = useRef(0);
  const framesRef = useRef(0);

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
    if (fps < MIN_SUSTAINED_FPS) store.downgrade();
    elapsedRef.current = 0;
    framesRef.current = 0;
  });

  return null;
}