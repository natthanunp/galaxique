/**
 * Heart constellation outline points (x, y, z=0), centered at origin.
 *
 * Generated parametrically from the classic heart curve, then sampled into a
 * Float32Array of ~120 points. The shape is scaled to roughly fit a unit box.
 */
function buildHeartPoints(): Float32Array {
  const N = 120;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    // Classic heart parametric equations.
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    // Normalize to ~[-1, 1] range; flip y so the heart points up.
    arr[i * 3] = x / 17;
    arr[i * 3 + 1] = y / 17;
    arr[i * 3 + 2] = 0;
  }
  return arr;
}

export const heartPoints = buildHeartPoints();
