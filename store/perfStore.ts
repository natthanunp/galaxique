"use client";

import { create } from "zustand";

import {
  initialQualityTier,
  type QualityTier,
  type RenderMetrics,
} from "@/lib/perf";

const TIERS: QualityTier[] = ["low", "medium", "high"];
const DOWNGRADE_COOLDOWN_MS = 2_500;
const UPGRADE_COOLDOWN_MS = 12_000;

interface PerfState {
  tier: QualityTier;
  metrics: RenderMetrics | null;
  lastTierChangeAt: number;
  /** Called by drei's <PerformanceMonitor onIncline> when sustained FPS is healthy. */
  upgrade: () => void;
  /** Called by drei's <PerformanceMonitor onDecline> when sustained FPS drops. */
  downgrade: () => void;
  recordMetrics: (metrics: RenderMetrics) => void;
}

/**
 * Live, cross-component render-quality tier. Seeded from a device/UA-based
 * guess (lib/perf.ts's initialQualityTier), then stepped up/down at runtime
 * by <PerformanceMonitor> in UniverseCanvas as it measures real frame times.
 * Consumers (CosmicBackground, ParticleField, Galaxy, UniverseCanvas) read
 * `tier` to scale particle counts, dpr, and enable/disable bloom/lensing.
 */
export const usePerfStore = create<PerfState>((set, get) => ({
  tier: typeof window !== "undefined" ? initialQualityTier() : "high",
  metrics: null,
  lastTierChangeAt: typeof window !== "undefined" ? Date.now() : 0,
  upgrade: () => {
    if (Date.now() - get().lastTierChangeAt < UPGRADE_COOLDOWN_MS) return;
    const i = TIERS.indexOf(get().tier);
    if (i < TIERS.length - 1) {
      set({ tier: TIERS[i + 1], lastTierChangeAt: Date.now() });
    }
  },
  downgrade: () => {
    if (Date.now() - get().lastTierChangeAt < DOWNGRADE_COOLDOWN_MS) return;
    const i = TIERS.indexOf(get().tier);
    if (i > 0) {
      set({ tier: TIERS[i - 1], lastTierChangeAt: Date.now() });
    }
  },
  recordMetrics: (metrics) => set({ metrics }),
}));
