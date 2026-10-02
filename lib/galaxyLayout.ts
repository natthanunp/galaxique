"use client";

/**
 * Places things on the spiral arms of the baked galaxy by sampling its
 * emission map, so stars and planets follow the real arms on screen.
 * Placement depends only on a world's own ID: new planets never move old ones.
 */

export const GALAXY_RADIUS = 5;
export const EMISSION_URL = "/assets/galaxy/stellar-emission-512.webp";

export interface ArmField {
  /** Interleaved x,y in disc units (-R..R). */
  points: Float32Array;
  /** Cumulative brightness weights, normalized to 1. */
  cumulative: Float32Array;
  cell: number;
}

export async function loadArmField(url = EMISSION_URL, size = 160): Promise<ArmField> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const xs: number[] = [];
  const ws: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 765;
      const u = (x + 0.5) / size * 2 - 1;
      const v = 1 - (y + 0.5) / size * 2;
      const r = Math.hypot(u, v);
      // Skip the bright core and the faint outskirts; planets live on the arms.
      if (lum < 0.12 || r < 0.16 || r > 0.94) continue;
      xs.push(u * GALAXY_RADIUS, v * GALAXY_RADIUS);
      ws.push(lum * lum);
    }
  }
  const cumulative = new Float32Array(ws.length);
  let total = 0;
  ws.forEach((w, i) => { total += w; cumulative[i] = total; });
  for (let i = 0; i < cumulative.length; i++) cumulative[i] /= total;
  return { points: new Float32Array(xs), cumulative, cell: (2 * GALAXY_RADIUS) / size };
}

export function hash32(value: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function sampleIndex(field: ArmField, u: number): number {
  let lo = 0, hi = field.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (field.cumulative[mid] < u) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Deterministic arm position for an ID: [x, y, z] in disc space. */
export function placeOnArms(field: ArmField, id: string): [number, number, number] {
  const i = sampleIndex(field, hash32(id, 1) / 4294967296);
  const jx = (hash32(id, 2) / 4294967296 - 0.5) * field.cell;
  const jy = (hash32(id, 3) / 4294967296 - 0.5) * field.cell;
  const jz = (hash32(id, 4) / 4294967296 - 0.5) * 0.12;
  return [field.points[i * 2] + jx, field.points[i * 2 + 1] + jy, jz];
}

/** Seeded star positions along the arms with depth layers. */
export function sampleStars(field: ArmField, count: number, seed = 7): Float32Array {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * 3);
  for (let n = 0; n < count; n++) {
    const i = sampleIndex(field, random());
    const x = field.points[i * 2] + (random() - 0.5) * field.cell * 2;
    const y = field.points[i * 2 + 1] + (random() - 0.5) * field.cell * 2;
    const r = Math.hypot(x, y) / GALAXY_RADIUS;
    out[n * 3] = x;
    out[n * 3 + 1] = y;
    out[n * 3 + 2] = (random() - 0.5) * 0.35 * (1.2 - r);
  }
  return out;
}

/** Thai weekday colors, by the visitor's local Bangkok day. */
export const THAI_DAY_COLORS = ["#ff4d5e", "#ffd84d", "#ff8fc8", "#4dd98a", "#ff9a3d", "#4da3ff", "#a970ff"];
export function thaiDayColor(date = new Date()): string {
  const day = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).getDay();
  return THAI_DAY_COLORS[day];
}
