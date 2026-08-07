"use client";

import { create } from "zustand";

import {
  type QualityTier,
  type RenderMetrics,
} from "@/lib/perf";

interface PerfState {
  tier: QualityTier;
  metrics: RenderMetrics | null;
  lastTierChangeAt: number;
  /** Retained for compatibility; reveal quality is always high. */
  upgrade: () => void;
  /** Retained for compatibility; reveal quality is always high. */
  downgrade: () => void;
  recordMetrics: (metrics: RenderMetrics) => void;
}

/**
 * Shared render-quality tier. It is pinned to high for a visually consistent
 * reveal; metrics are collected only for diagnostics.
 */
export const usePerfStore = create<PerfState>((set, get) => ({
  tier: "high",
  metrics: null,
  lastTierChangeAt: 0,
  upgrade: () => {},
  downgrade: () => {},
  recordMetrics: (metrics) => set({ metrics }),
}));
