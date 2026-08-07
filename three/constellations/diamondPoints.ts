/**
 * Diamond constellation with volumetric 3D structure.
 *
 * Generates particles along the outline of a brilliant-cut diamond silhouette
 * and fills the interior with rejection-sampled points. The shape is built
 * from a symmetric crown (top facets) and pavilion (lower facets) so it reads
 * as a cut gemstone rather than a flat rotated square.
 */
function buildDiamondPoints(): Float32Array {
  const OUTLINE_POINTS = 220;
  const INTERIOR_POINTS = 350;
  const TOTAL = OUTLINE_POINTS + INTERIOR_POINTS;
  const arr = new Float32Array(TOTAL * 3);
  let idx = 0;

  // Normalized diamond silhouette vertices, clockwise from top.
  // (x, y) in [-1, 1].
  const verts: [number, number][] = [
    [0, 1], // table top
    [0.55, 0.45], // upper girdle left
    [0.85, 0], // girdle left
    [0.55, -0.45], // lower girdle left
    [0, -1], // culet bottom
    [-0.55, -0.45], // lower girdle right
    [-0.85, 0], // girdle right
    [-0.55, 0.45], // upper girdle right
  ];

  // Outline — trace each edge with jittered depth for a 3D edge.
  const pointsPerEdge = Math.floor(OUTLINE_POINTS / verts.length);
  for (let e = 0; e < verts.length; e++) {
    const [x0, y0] = verts[e];
    const [x1, y1] = verts[(e + 1) % verts.length];
    for (let j = 0; j < pointsPerEdge; j++) {
      const f = j / pointsPerEdge;
      arr[idx * 3] = x0 + (x1 - x0) * f;
      arr[idx * 3 + 1] = y0 + (y1 - y0) * f;
      // Slight front-to-back thickness, thicker at the girdle.
      arr[idx * 3 + 2] = (Math.random() - 0.5) * 0.22;
      idx++;
    }
  }

  // Interior fill using rejection sampling inside the diamond polygon.
  for (let i = 0; i < INTERIOR_POINTS; i++) {
    let x: number;
    let y: number;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      attempts++;
    } while (!isInsideDiamond(x, y) && attempts < 60);

    if (attempts < 60) {
      arr[idx * 3] = x;
      arr[idx * 3 + 1] = y;
      // Depth is thicker near the center (table/culet), thinner at girdle.
      const centerBias = 1 - Math.abs(y);
      const depth = (Math.random() + Math.random() - 1) * 0.35 * (0.6 + 0.4 * centerBias);
      arr[idx * 3 + 2] = depth;
      idx++;
    }
  }

  return arr.slice(0, idx * 3);
}

/** Ray-casting test for the symmetric diamond polygon. */
function isInsideDiamond(x: number, y: number): boolean {
  const top: [number, number] = [0, 1];
  const right: [number, number] = [0.85, 0];
  const bottom: [number, number] = [0, -1];
  const left: [number, number] = [-0.85, 0];

  // Diamond is convex, so a point is inside if it is on the inner side of
  // all four edge lines: top-right, right-bottom, bottom-left, left-top.
  const edges: Array<[[number, number], [number, number]]> = [
    [top, right],
    [right, bottom],
    [bottom, left],
    [left, top],
  ];

  for (const [[x0, y0], [x1, y1]] of edges) {
    const cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    if (cross > 0) return false;
  }
  return true;
}

export const diamondPoints = buildDiamondPoints();
