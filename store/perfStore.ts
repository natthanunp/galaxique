"use client";
import { create } from 'zustand';
import { initialQualityTier, type QualityTier, type RenderMetrics } from '@/lib/perf';

interface PerfState {
  tier: QualityTier;
  metrics: RenderMetrics | null;
  lastTierChangeAt: number;
  initialize: () => void;
  upgrade: () => void;
  downgrade: () => void;
  recordMetrics: (metrics: RenderMetrics) => void;
}
const tiers: QualityTier[] = ['low', 'medium', 'high'];
export const usePerfStore = create<PerfState>((set, get) => {
  const change = (direction: number) => {
    const state = get(), now = performance.now();
    if (now - state.lastTierChangeAt < 8000) return;
    const tier = tiers[Math.max(0, Math.min(2, tiers.indexOf(state.tier) + direction))];
    if (tier !== state.tier) set({ tier, lastTierChangeAt: now });
  };
  return {
    tier: 'high', metrics: null, lastTierChangeAt: 0,
    initialize: () => set({tier: initialQualityTier(), lastTierChangeAt: performance.now()}),
    upgrade: () => change(1), downgrade: () => change(-1),
    recordMetrics: metrics => set({metrics}),
  };
});
