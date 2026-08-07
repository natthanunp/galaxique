/**
 * Five-pointed star constellation with volumetric 3D structure.
 *
 * Generates particles both on the surface outline and inside the star volume,
 * with depth variation for a realistic 3D appearance. Uses the star polygon
 * inequality to fill the interior.
 */
function buildStarPoints(): Float32Array {
  const SURFACE_POINTS = 150;
  const INTERIOR_POINTS = 250;
  const TOTAL = SURFACE_POINTS + INTERIOR_POINTS;
  const arr = new Float32Array(TOTAL * 3);
  let idx = 0;

  const outer = 1.0;
  const inner = 0.42;
  const verts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    verts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }

  // Surface outline - classic star shape
  const pointsPerEdge = 15;
  for (let e = 0; e < 10; e++) {
    const [x0, y0] = verts[e];
    const [x1, y1] = verts[(e + 1) % 10];
    for (let j = 0; j < pointsPerEdge; j++) {
      const f = j / pointsPerEdge;
      arr[idx * 3] = x0 + (x1 - x0) * f;
      arr[idx * 3 + 1] = y0 + (y1 - y0) * f;
      // Add slight depth variation for 3D feel
      arr[idx * 3 + 2] = (Math.random() - 0.5) * 0.15;
      idx++;
    }
  }

  // Interior fill - sample points inside the star volume
  for (let i = 0; i < INTERIOR_POINTS; i++) {
    let x: number, y: number;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      attempts++;
    } while (!isInsideStar(x, y, verts) && attempts < 50);

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

/** Check if point (x,y) is inside the star shape using ray casting */
function isInsideStar(x: number, y: number, verts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], yi = verts[i][1];
    const xj = verts[j][0], yj = verts[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export const starPoints = buildStarPoints();
