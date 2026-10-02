import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getRedis, V2_PREFIX } from "@/lib/redis";
import type { StoredReveal } from "@/lib/revealStore";
import type {
  CelestialType,
  CelestialVisualConfig,
  CentralSymbol,
  CreatureSpec,
  Language,
  ParticleDensity,
  Vibe,
} from "@/types/universe";
import type { ProfileTheme } from "@/lib/profile";

/** Published, visit-ready world. Contains only what the owner consented to share. */
export interface WorldSnapshot {
  version: 1;
  id: string;
  createdAt: number;
  language: Language;
  status: "published" | "unpublished" | "hidden";
  scene: {
    vibe: Vibe;
    theme?: ProfileTheme;
    celestial_type: CelestialType;
    celestial_config?: CelestialVisualConfig;
    central_symbol: CentralSymbol;
    rotation_speed: number;
    particle_density: ParticleDensity;
  };
  planet: { primary_color: string; secondary_color: string; seed: number };
  /** The owner's personal sky, rendered overhead after landing. */
  sky: { primary_color: string; secondary_color: string; celestial_type: CelestialType; celestial_config?: CelestialVisualConfig };
  creature: CreatureSpec & { name: string; traits: { energy: number } };
  reading: string | null;
  song: { track_id: string; isrc: string | null; name: string; artist: string } | null;
}

/** Fields safe for the discovery index and galaxy view. */
export interface WorldSummary {
  id: string;
  createdAt: number;
  primary_color: string;
  secondary_color: string;
  celestial_type: CelestialType;
  creature_kind: CreatureSpec["kind"];
}

const worldKey = (id: string) => `${V2_PREFIX}world:${id}`;
const ownerKey = (tokenHash: string) => `${V2_PREFIX}owner:${tokenHash}`;
const byRevealKey = (revealId: string) => `${V2_PREFIX}world-by-reveal:${revealId}`;
const INDEX_KEY = `${V2_PREFIX}worlds:index`;
const REPORTS_KEY = `${V2_PREFIX}worlds:reports`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function ownerTokenFrom(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+([\w-]{16,128})$/)?.[1] ?? null;
}

const ENERGY: Record<string, number> = {
  driven: 0.9, imaginative: 0.75, affectionate: 0.6, questioning: 0.55, grounded: 0.35, reflective: 0.3,
  intense: 0.9, whimsical: 0.75, cute: 0.65, cynical: 0.5, mysterious: 0.35, cozy: 0.3,
};

function seedOf(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32BE(0);
}

const memory = { worlds: new Map<string, WorldSnapshot>(), owners: new Map<string, Set<string>>(), byReveal: new Map<string, string>() };

export function summarize(world: WorldSnapshot): WorldSummary {
  return {
    id: world.id,
    createdAt: world.createdAt,
    primary_color: world.planet.primary_color,
    secondary_color: world.planet.secondary_color,
    celestial_type: world.scene.celestial_type,
    creature_kind: world.creature.kind,
  };
}

export function buildSnapshot(stored: StoredReveal, includeReading: boolean): WorldSnapshot {
  const { reveal } = stored;
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const creature = reveal.creature ?? { kind: "spirit" as const, accent: "none" as const, motion: "bob" as const };
  return {
    version: 1,
    id,
    createdAt: Date.now(),
    language: stored.language,
    status: "published",
    scene: {
      vibe: reveal.vibe,
      theme: reveal.theme,
      celestial_type: reveal.celestial_type,
      celestial_config: reveal.celestial_config,
      central_symbol: reveal.central_symbol,
      rotation_speed: reveal.rotation_speed,
      particle_density: reveal.particle_density,
    },
    planet: { primary_color: reveal.primary_color, secondary_color: reveal.secondary_color, seed: seedOf(id) },
    sky: {
      primary_color: reveal.primary_color,
      secondary_color: reveal.secondary_color,
      celestial_type: reveal.celestial_type,
      celestial_config: reveal.celestial_config,
    },
    creature: {
      ...creature,
      name: creature.name ?? (stored.language === "th" ? "เพื่อนคู่ใจ" : "Companion"),
      traits: { energy: ENERGY[reveal.theme ?? reveal.vibe] ?? 0.5 },
    },
    reading: includeReading ? reveal.personality_reading : null,
    song: reveal.spotify_track_id
      ? { track_id: reveal.spotify_track_id, isrc: stored.isrc ?? null, name: stored.song?.name ?? "", artist: stored.song?.artist ?? "" }
      : null,
  };
}

export async function publishedIdForReveal(revealId: string): Promise<string | null> {
  const redis = getRedis();
  return (redis ? await redis.get<string>(byRevealKey(revealId)) : memory.byReveal.get(revealId)) ?? null;
}

/** Publishes once per reveal. Returns the world and a one-time owner token. */
export async function publishWorld(revealId: string, world: WorldSnapshot): Promise<{ world: WorldSnapshot; ownerToken: string } | { existingId: string }> {
  const ownerToken = randomBytes(24).toString("base64url");
  const tokenHash = hashToken(ownerToken);
  const redis = getRedis();
  if (!redis) {
    const existing = memory.byReveal.get(revealId);
    if (existing) return { existingId: existing };
    memory.byReveal.set(revealId, world.id);
    memory.worlds.set(world.id, world);
    memory.owners.set(tokenHash, new Set([world.id]));
    return { world, ownerToken };
  }
  // NX makes concurrent publishes of the same reveal safe.
  const claimed = await redis.set(byRevealKey(revealId), world.id, { nx: true });
  if (!claimed) return { existingId: (await redis.get<string>(byRevealKey(revealId))) ?? "" };
  await redis.pipeline()
    .set(worldKey(world.id), { ...world, ownerHash: tokenHash, revealId })
    .zadd(INDEX_KEY, { score: world.createdAt, member: world.id })
    .sadd(ownerKey(tokenHash), world.id)
    .exec();
  return { world, ownerToken };
}

type StoredWorld = WorldSnapshot & { ownerHash?: string; revealId?: string };

async function readWorld(id: string): Promise<StoredWorld | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const redis = getRedis();
  return redis ? await redis.get<StoredWorld>(worldKey(id)) : memory.worlds.get(id) ?? null;
}

function publicWorld(world: StoredWorld): WorldSnapshot {
  const { ownerHash: _ownerHash, revealId: _revealId, ...rest } = world;
  void _ownerHash; void _revealId;
  return rest;
}

/** Published worlds only; hidden/unpublished worlds are invisible to visitors. */
export async function getWorld(id: string): Promise<WorldSnapshot | null> {
  const world = await readWorld(id);
  return world?.status === "published" ? publicWorld(world) : null;
}

export async function listWorlds(beforeMs: number, limit: number): Promise<{ worlds: WorldSummary[]; next: number | null }> {
  const redis = getRedis();
  let ids: string[];
  if (redis) {
    ids = await redis.zrange<string[]>(INDEX_KEY, `(${beforeMs}`, "-inf", { byScore: true, rev: true, offset: 0, count: limit });
  } else {
    ids = [...memory.worlds.values()].filter((w) => w.status === "published" && w.createdAt < beforeMs)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((w) => w.id);
  }
  const worlds = (await Promise.all(ids.map(getWorld))).filter((w): w is WorldSnapshot => w !== null).map(summarize);
  return { worlds, next: ids.length === limit ? worlds.at(-1)?.createdAt ?? null : null };
}

export async function ownedWorldIds(ownerToken: string): Promise<string[]> {
  const tokenHash = hashToken(ownerToken);
  const redis = getRedis();
  return redis ? await redis.smembers(ownerKey(tokenHash)) : [...(memory.owners.get(tokenHash) ?? [])];
}

async function ownedWorld(id: string, ownerToken: string): Promise<StoredWorld | null> {
  const world = await readWorld(id);
  if (!world) return null;
  return (await ownedWorldIds(ownerToken)).includes(id) ? world : null;
}

/** Owner toggles visibility. Reported worlds stay hidden until reviewed. */
export async function setPublished(id: string, ownerToken: string, published: boolean): Promise<boolean> {
  const world = await ownedWorld(id, ownerToken);
  if (!world || world.status === "hidden") return false;
  const next: StoredWorld = { ...world, status: published ? "published" : "unpublished" };
  const redis = getRedis();
  if (!redis) {
    memory.worlds.set(id, next);
    return true;
  }
  const pipeline = redis.pipeline().set(worldKey(id), next);
  if (published) pipeline.zadd(INDEX_KEY, { score: world.createdAt, member: id });
  else pipeline.zrem(INDEX_KEY, id);
  await pipeline.exec();
  return true;
}

export async function deleteWorld(id: string, ownerToken: string): Promise<boolean> {
  const world = await ownedWorld(id, ownerToken);
  if (!world) return false;
  const tokenHash = hashToken(ownerToken);
  const redis = getRedis();
  if (!redis) {
    memory.worlds.delete(id);
    memory.owners.get(tokenHash)?.delete(id);
    if (world.revealId) memory.byReveal.delete(world.revealId);
    return true;
  }
  const pipeline = redis.pipeline()
    .del(worldKey(id))
    .zrem(INDEX_KEY, id)
    .srem(ownerKey(tokenHash), id)
    .del(`${V2_PREFIX}greet:${id}:en`, `${V2_PREFIX}greet:${id}:th`);
  if (world.revealId) pipeline.del(byRevealKey(world.revealId));
  await pipeline.exec();
  return true;
}

/** Hides the world from discovery pending owner review. */
export async function reportWorld(id: string, reason: string): Promise<boolean> {
  const world = await readWorld(id);
  if (!world || world.status !== "published") return false;
  const redis = getRedis();
  if (!redis) {
    memory.worlds.set(id, { ...world, status: "hidden" });
    return true;
  }
  await redis.pipeline()
    .set(worldKey(id), { ...world, status: "hidden" })
    .zrem(INDEX_KEY, id)
    .lpush(REPORTS_KEY, JSON.stringify({ id, reason, at: Date.now() }))
    .ltrim(REPORTS_KEY, 0, 999)
    .exec();
  return true;
}
