"use client";

let _isMobile: boolean | null = null;
let _isLowPower: boolean | null = null;

/**
 * Heuristic for mobile/low-power devices.
 * Used to reduce particle counts, geometry, and pixel ratio for 60fps.
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (_isMobile !== null) return _isMobile;
  const ua = navigator.userAgent || "";
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 1;
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  _isMobile = mobileUA || (touch && window.innerWidth < 1024);
  return _isMobile;
}

/** Approximate GPU tier based on common mobile indicators. */
export function isLowPowerDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (_isLowPower !== null) return _isLowPower;
  const ua = navigator.userAgent || "";
  const ram = (navigator as typeof navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const oldOrWeak = /Android [1-9](?:[.; ]|$)|iPhone OS [1-9]_|iPad.*OS [1-9]_/.test(ua);
  _isLowPower = isMobileDevice() && (ram < 4 || cores < 6 || oldOrWeak || window.innerWidth < 400);
  return _isLowPower;
}

/** Cap DPR aggressively on mobile to reduce fill-rate pressure. */
export function targetDpr(): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio || 1;
  if (isLowPowerDevice()) return Math.min(dpr, 1);
  if (isMobileDevice()) return Math.min(dpr, 1.25);
  return Math.min(dpr, 1.5);
}

/**
 * Firefox and Edge have historically shown slower WebGL point-cloud
 * rasterization and shader JIT warm-up than Chrome/Safari on this app
 * (no Angle-equivalent fast path on Firefox; Edge has patchier driver
 * coverage for some GPUs). Used only as a conservative starting hint —
 * the live RenderPerformanceMetrics in UniverseCanvas is the source of truth
 * once real frame times are measured.
 */
export function isFirefoxOrEdgeUA(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Firefox\//.test(ua) || /Edg\//.test(ua);
}

/** Adaptive render-quality tier. Higher = more particles/effects. */
export type QualityTier = "low" | "medium" | "high";

/** One-second render sample used to diagnose and adapt visual budgets. */
export interface RenderMetrics {
  fps: number;
  frameTimeMs: number;
  p95FrameTimeMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  dpr: number;
  width: number;
  height: number;
  sampledAt: number;
}

/** Start within a device-appropriate budget; sustained render samples adapt it.
 * Mobile and conservative browser hints start at medium, low-power at low. */
export function initialQualityTier(): QualityTier {
  if (isLowPowerDevice()) return "low";
  if (isMobileDevice() || isFirefoxOrEdgeUA()) return "medium";
  return "high";
}

/** Scales baseline particle/segment counts by tier. */
export function tierParticleMultiplier(tier: QualityTier): number {
  switch (tier) {
    case "low":
      return 0.35;
    case "medium":
      return 0.65;
    case "high":
      return 1;
  }
}

/** Further caps dpr (on top of the device-based targetDpr()) by live tier. */
export function tierDprCap(tier: QualityTier, baseDpr: number): number {
  if (tier === "low") return Math.min(baseDpr, 1);
  if (tier === "medium") return Math.min(baseDpr, 1.25);
  return baseDpr;
}

/** Which expensive postprocessing passes are allowed at this tier.
 *  Bloom and lensing are now always-on; the live render monitor
 *  adapts DPR and particle counts instead, which has a much smaller
 *  visual impact than silently disabling bloom (which made the
 *  accretion disk and central glow look "dead" on first paint). */
export function tierEffectsEnabled(tier: QualityTier): {
  bloom: boolean;
  lensing: boolean;
} {
  return {
    bloom: true,
    lensing: true,
  };
}
