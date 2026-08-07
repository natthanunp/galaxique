/**
 * Heart constellation with volumetric 3D structure.
 *
 * Generates particles both on the surface and inside the heart volume,
 * with depth variation for a realistic 3D appearance. The shape uses
 * the classic heart curve extruded into 3D with Gaussian thickness.
 */
function buildHeartPoints(): Float32Array {
  const SURFACE_POINTS = 200;
  const INTERIOR_POINTS = 300;
  const TOTAL = SURFACE_POINTS + INTERIOR_POINTS;
  const arr = new Float32Array(TOTAL * 3);
  let idx = 0;

  // Surface outline - classic heart curve
  for (let i = 0; i < SURFACE_POINTS; i++) {
    const t = (i / SURFACE_POINTS) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    // Normalize to ~[-1, 1] range; flip y so the heart points up
    arr[idx * 3] = x / 17;
    arr[idx * 3 + 1] = y / 17;
    // Add slight depth variation for 3D feel
    arr[idx * 3 + 2] = (Math.random() - 0.5) * 0.15;
    idx++;
  }

  // Interior fill - sample points inside the heart volume
  for (let i = 0; i < INTERIOR_POINTS; i++) {
    // Use rejection sampling to fill the heart interior
    let x: number, y: number;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 2; // [-1, 1]
      y = (Math.random() - 0.5) * 2; // [-1, 1]
      attempts++;
    } while (!isInsideHeart(x, y) && attempts < 50);

    if (attempts < 50) {
      arr[idx * 3] = x;
      arr[idx * 3 + 1] = y;
      // Depth follows Gaussian distribution - thicker in center
      const depth = (Math.random() + Math.random() + Math.random() - 1.5) * 0.3;
      arr[idx * 3 + 2] = depth;
      idx++;
    }
  }

  return arr.slice(0, idx * 3);
}

/** Check if point (x,y) is inside the heart shape */
function isInsideHeart(x: number, y: number): boolean {
  // Heart inequality: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

export const heartPoints = buildHeartPoints();
