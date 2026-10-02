import * as THREE from "three";

export interface SurfacePalette {
  soil: THREE.Color;
  moss: THREE.Color;
  stone: THREE.Color;
  foliage: THREE.Color;
  blossom: THREE.Color;
  glow: THREE.Color;
  haze: THREE.Color;
}

export interface SurfaceInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  variant: number;
}

export function surfaceRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function surfacePalette(primary: string, secondary: string): SurfacePalette {
  const accent = new THREE.Color(secondary);
  return {
    soil: new THREE.Color("#434b40").lerp(new THREE.Color(primary), 0.12),
    moss: new THREE.Color("#687e51"),
    stone: new THREE.Color("#8c9990").lerp(accent, 0.08),
    foliage: new THREE.Color("#86ad78").lerp(accent, 0.12),
    blossom: new THREE.Color("#de9b96").lerp(new THREE.Color(primary), 0.1),
    glow: new THREE.Color("#d8edaa").lerp(accent, 0.25),
    haze: new THREE.Color("#101d23").lerp(accent, 0.035),
  };
}

export function surfaceHeight(x: number, z: number, seed: number): number {
  const phase = (seed % 997) * 0.013;
  const radius = Math.hypot(x, z);
  const clearing = THREE.MathUtils.smoothstep(radius, 2.3, 5.5);
  const hills = Math.sin(x * 0.24 + phase) * Math.cos(z * 0.19 - phase) * 0.65
    + Math.sin(x * 0.47 + z * 0.32 + phase) * 0.2;
  const basin = THREE.MathUtils.smoothstep(radius, 5, 18) * 0.8;
  const ridge = THREE.MathUtils.smoothstep(-z, 9, 24)
    * (1.5 + Math.sin(x * 0.22 + phase) * 0.65 + Math.sin(x * 0.57) * 0.3);
  return clearing * (Math.max(-0.28, hills) + basin + ridge);
}

export function createSurfaceTerrain(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(100, 100, 100, 100);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -12);
  const positions = geometry.getAttribute("position");
  const random = surfaceRandom(seed);
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) + (random() - 0.5) * 0.65;
    const z = positions.getZ(index) + (random() - 0.5) * 0.65;
    positions.setXYZ(index, x, surfaceHeight(x, z, seed), z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSurfaceInstances(seed: number, count: number, kind: "grass" | "rock" | "flower" | "tree" | "spire"): SurfaceInstance[] {
  const salt = { grass: 17, rock: 83, flower: 137, tree: 251, spire: 419 }[kind];
  const random = surfaceRandom(seed + salt);
  const result: SurfaceInstance[] = [];
  const maxAttempts = count * 18;
  for (let attempt = 0; result.length < count && attempt < maxAttempts; attempt++) {
    const x = (random() - 0.5) * (kind === "grass" || kind === "flower" ? 36 : 56);
    const z = -random() * 34 + 9;
    const radius = Math.hypot(x, z);
    const cluster = Math.sin(x * 0.65 + seed % 31) * Math.cos(z * 0.47) + Math.sin(z * 0.8 + x * 0.2) * 0.35;
    if (radius < (kind === "rock" ? 2.6 : 3.3)) continue;
    if (z > -5 && Math.abs(x) < 1.15 + Math.max(z, 0) * 0.12) continue;
    if (kind === "grass" && cluster < -0.25) continue;
    if (kind === "flower" && (cluster < 0.4 || radius > 19)) continue;
    if ((kind === "tree" || kind === "spire") && (Math.abs(x) < 5.5 || z > -5 || radius < 9)) continue;
    result.push({
      x, y: surfaceHeight(x, z, seed), z,
      scale: kind === "grass" ? 0.3 + random() * 0.7
        : kind === "rock" ? 0.16 + random() ** 2 * 1.25
          : kind === "flower" ? 0.45 + random() * 0.6
            : kind === "spire" ? 1.3 + random() * 1.5 : 1.1 + random() * 1.5,
      yaw: random() * Math.PI * 2,
      variant: random(),
    });
  }
  return result;
}

export function createGrassGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * 2.4;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const width = 0.045;
    const height = 0.42 + (blade % 3) * 0.1;
    const baseX = dx * 0.1;
    const baseZ = dz * 0.1;
    const left = [baseX - dz * width, 0, baseZ + dx * width];
    const right = [baseX + dz * width, 0, baseZ - dx * width];
    const middleLeft = [baseX + dx * 0.08 - dz * width * 0.6, height * 0.55, baseZ + dz * 0.08 + dx * width * 0.6];
    const middleRight = [baseX + dx * 0.08 + dz * width * 0.6, height * 0.55, baseZ + dz * 0.08 - dx * width * 0.6];
    const tip = [baseX + dx * 0.22, height, baseZ + dz * 0.22];
    positions.push(...left, ...right, ...middleLeft, ...right, ...middleRight, ...middleLeft, ...middleLeft, ...middleRight, ...tip);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createStoneGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const variation = 1 + Math.sin(x * 13 + y * 7 + z * 5) * 0.12;
    positions.setXYZ(index, x * variation, (y + 1) * 0.55 * variation - 0.08, z * variation * 0.85);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}