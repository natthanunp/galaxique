import type { QualityTier } from './perf';

/** Shared art direction; all assets are local to preserve export origin-cleanliness. */
export const COSMIC = {
  background: '#03050c',
  core: '#ffe0af',
  aoIntensity: 0.38,
  backgroundUrl: (mobile: boolean) => `/assets/galaxy/galaxy-${mobile ? 'mobile' : 'desktop'}.webp`,
  textureUrl: (name: 'stellar-emission' | 'dust-absorption' | 'deep-field', tier: QualityTier) =>
    `/assets/galaxy/${name}-${tier === 'high' ? 1024 : 512}.webp`,
  starBudget: { low: 28, medium: 48, high: 72 },
} as const;

export const VIBE_GRADE: Record<string, string> = {
  cute: '#f472b6', cozy: '#fbbf77', mysterious: '#887bdd',
  intense: '#ed7659', whimsical: '#72cfba', cynical: '#94a3b8',
};

export function communityGrade(stats?: Record<string, number> | null): string {
  let total = 0; const rgb = [0, 0, 0];
  for (const [vibe, color] of Object.entries(VIBE_GRADE)) {
    const count = Math.max(0, Number(stats?.[vibe]) || 0);
    total += count;
    rgb.forEach((_, i) => { rgb[i] += parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) * count; });
  }
  return total ? `rgb(${rgb.map(value => Math.round(value / total)).join(',')})` : '#8a9bbf';
}
