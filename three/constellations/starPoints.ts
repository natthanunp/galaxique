/**
 * Five-pointed star constellation outline points (x, y, z=0), centered at origin.
 *
 * Built by walking the 10 vertices (5 outer + 5 inner) of a star polygon and
 * interpolating along each edge so the outline reads as a dotted constellation.
 */
function buildStarPoints(): Float32Array {
  const pointsPerEdge = 12;
  const outer = 1.0;
  const inner = 0.42;
  const verts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // Start at top (-90deg) and go clockwise.
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    verts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }

  const out: number[] = [];
  for (let e = 0; e < 10; e++) {
    const [x0, y0] = verts[e];
    const [x1, y1] = verts[(e + 1) % 10];
    for (let j = 0; j < pointsPerEdge; j++) {
      const f = j / pointsPerEdge;
      out.push(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 0);
    }
  }
  return new Float32Array(out);
}

export const starPoints = buildStarPoints();
