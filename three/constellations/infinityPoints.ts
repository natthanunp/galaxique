/**
 * Infinity (∞) constellation with volumetric 3D structure.
 *
 * Built from two parametric lemniscate loops joined smoothly at the center.
 * Points follow the ribbon outline and fill the interior so the shape glows
 * like a continuous cosmic loop rather than a thin wireframe.
 */
function buildInfinityPoints(): Float32Array {
  const OUTLINE_POINTS = 260;
  const INTERIOR_POINTS = 320;
  const TOTAL = OUTLINE_POINTS + INTERIOR_POINTS;
  const arr = new Float32Array(TOTAL * 3);
  let idx = 0;

  // Lemniscate of Bernoulli scaled to fit roughly in [-1, 1].
  function lemniscate(t: number): [number, number] {
    const a = 1.15;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const denom = 1 + sin * sin;
    const x = (a * cos) / denom;
    const y = (a * sin * cos) / denom;
    return [x, -y]; // flip y so the right loop is on the right
  }

  // Outline — sample the curve densely, with depth jitter for volume.
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const t = (i / OUTLINE_POINTS) * Math.PI * 2;
    const [x, y] = lemniscate(t);
    arr[idx * 3] = x;
    arr[idx * 3 + 1] = y;
    arr[idx * 3 + 2] = (Math.random() - 0.5) * 0.18;
    idx++;
  }

  // Interior fill — rejection sample inside a thickened lemniscate band.
  for (let i = 0; i < INTERIOR_POINTS; i++) {
    let x: number;
    let y: number;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 2.4;
      y = (Math.random() - 0.5) * 1.4;
      attempts++;
    } while (!isInsideInfinity(x, y) && attempts < 70);

    if (attempts < 70) {
      arr[idx * 3] = x;
      arr[idx * 3 + 1] = y;
      // Depth thicker near the crossover center, thinner at the outer loops.
      const distToCenter = Math.sqrt(x * x + y * y);
      const depth = (Math.random() + Math.random() - 1) * 0.3 * (1.1 - distToCenter * 0.35);
      arr[idx * 3 + 2] = depth;
      idx++;
    }
  }

  return arr.slice(0, idx * 3);
}

/** True when (x,y) is within a thickened lemniscate ribbon. */
function isInsideInfinity(x: number, y: number): boolean {
  const a = 1.15;
  // Convert to polar-ish lemniscate equation:
  // r^2 = a^2 * cos(2*theta). We allow a band around this curve.
  const r2 = x * x + y * y;
  const theta = Math.atan2(y, x);
  const ribbonR2 = a * a * Math.cos(2 * theta);
  if (ribbonR2 < 0) return false;

  const ribbonWidth = 0.18;
  const edgeR = Math.sqrt(ribbonR2);
  const r = Math.sqrt(r2);
  return Math.abs(r - edgeR) < ribbonWidth;
}

export const infinityPoints = buildInfinityPoints();
