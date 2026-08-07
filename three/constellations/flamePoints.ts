/**
 * Flame constellation with volumetric 3D structure.
 *
 * Generates particles along a natural teardrop flame outline and fills the
 * body with turbulent, upward-biased sampling. The shape feels energetic and
 * organic without looking like a cartoon icon.
 */
function buildFlamePoints(): Float32Array {
  const OUTLINE_POINTS = 240;
  const INTERIOR_POINTS = 360;
  const TOTAL = OUTLINE_POINTS + INTERIOR_POINTS;
  const arr = new Float32Array(TOTAL * 3);
  let idx = 0;

  // Flame boundary is provided by the shared flameBoundary() below.

  // Outline — trace both sides of the flame.
  const halfOutline = Math.floor(OUTLINE_POINTS / 2);
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    for (let i = 0; i < halfOutline; i++) {
      const y = -1 + (i / (halfOutline - 1)) * 2;
      const x = sign * flameBoundary(y);
      arr[idx * 3] = x;
      arr[idx * 3 + 1] = y;
      // Flame has more depth near the base, tapering toward the tip.
      const depth = 0.25 * (1 - (y + 1) / 2) * (Math.random() - 0.5);
      arr[idx * 3 + 2] = depth;
      idx++;
    }
  }

  // Interior fill — rejection sample inside the flame body.
  for (let i = 0; i < INTERIOR_POINTS; i++) {
    let x: number;
    let y: number;
    let attempts = 0;
    do {
      y = -1 + Math.random() * 2;
      const w = flameBoundary(y);
      x = (Math.random() - 0.5) * 2 * w * 1.05;
      attempts++;
    } while (!isInsideFlame(x, y) && attempts < 60);

    if (attempts < 60) {
      arr[idx * 3] = x;
      arr[idx * 3 + 1] = y;
      // Add turbulent depth: hotter core pushes forward, outer edges recede.
      const coreStrength = 1 - Math.abs(x) / Math.max(1e-6, flameBoundary(y));
      const depth = (Math.random() + Math.random() - 1) * 0.3 * (0.5 + 0.5 * coreStrength);
      arr[idx * 3 + 2] = depth;
      idx++;
    }
  }

  return arr.slice(0, idx * 3);
}

/** True when (x,y) lies inside the flame silhouette. */
function isInsideFlame(x: number, y: number): boolean {
  if (y < -1 || y > 1) return false;
  const w = flameBoundary(y);
  return Math.abs(x) <= w;
}

/** Flame boundary: a teardrop with a flickering top (shared by generator and hit-test). */
function flameBoundary(y: number): number {
  const width = 0.28 * (1 - y) * Math.sqrt(Math.max(0, 1 + y));
  const flicker = 1 + 0.08 * Math.sin(y * 9) + 0.04 * Math.cos(y * 17);
  return Math.max(0, width * flicker);
}

export const flamePoints = buildFlamePoints();
