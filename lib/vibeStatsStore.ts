import { Redis } from "@upstash/redis";

/**
 * Real-time vibe statistics for the landing page counter.
 * Tracks total universe reveals and per-vibe counts.
 *
 * Uses the same Upstash Redis instance as songSelectionStore.
 * Falls back to in-memory storage when credentials aren't configured.
 */

const STATS_KEY = "galaxseea:vibe-stats";
const CELESTIAL_STATS_KEY = "galaxseea:celestial-stats";

export type VibeStats = {
  total: number;
  cute: number;
  cozy: number;
  mysterious: number;
  intense: number;
  whimsical: number;
  cynical: number;
};

export type CelestialStats = {
  total: number;
  galaxy: number;
  black_hole: number;
  neutron_star: number;
};

export type StatsSource = "upstash" | "memory";

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  if (!redisClient) {
    console.warn(
      "[vibeStatsStore] No Upstash credentials found — falling back to in-memory stats. " +
        "This has no cross-instance memory in production.",
    );
  }
  return redisClient;
}

// In-memory fallback
let memoryStats: VibeStats = {
  total: 0,
  cute: 0,
  cozy: 0,
  mysterious: 0,
  intense: 0,
  whimsical: 0,
  cynical: 0,
};

let memoryCelestialStats: CelestialStats = {
  total: 0,
  galaxy: 0,
  black_hole: 0,
  neutron_star: 0,
};

export async function incrementVibeStat(vibe: keyof Omit<VibeStats, "total">): Promise<{
  stats: VibeStats;
  source: StatsSource;
}> {
  const redis = getRedisClient();

  if (redis) {
    // Use Redis hash for atomic increments
    await redis.hincrby(STATS_KEY, vibe, 1);
    await redis.hincrby(STATS_KEY, "total", 1);

    const stats = await redis.hgetall<VibeStats>(STATS_KEY);
    return {
      stats: stats || memoryStats,
      source: "upstash",
    };
  }

  // In-memory fallback
  memoryStats[vibe]++;
  memoryStats.total++;
  return {
    stats: { ...memoryStats },
    source: "memory",
  };
}

export async function getVibeStats(): Promise<{
  stats: VibeStats;
  source: StatsSource;
}> {
  const redis = getRedisClient();

  if (redis) {
    const stats = await redis.hgetall<VibeStats>(STATS_KEY);
    return {
      stats: stats || { total: 0, cute: 0, cozy: 0, mysterious: 0, intense: 0, whimsical: 0, cynical: 0 },
      source: "upstash",
    };
  }

  // In-memory fallback
  return {
    stats: { ...memoryStats },
    source: "memory",
  };
}

/** Increments a celestial-type counter. Mirrors `incrementVibeStat` so the
 *  /api/stats/increment route can update both stats in a single call. */
export async function incrementCelestialStat(
  celestialType: keyof Omit<CelestialStats, "total">,
): Promise<{ stats: CelestialStats; source: StatsSource }> {
  const redis = getRedisClient();

  if (redis) {
    await redis.hincrby(CELESTIAL_STATS_KEY, celestialType, 1);
    await redis.hincrby(CELESTIAL_STATS_KEY, "total", 1);

    const stats = await redis.hgetall<CelestialStats>(CELESTIAL_STATS_KEY);
    return {
      stats: stats || memoryCelestialStats,
      source: "upstash",
    };
  }

  memoryCelestialStats[celestialType]++;
  memoryCelestialStats.total++;
  return {
    stats: { ...memoryCelestialStats },
    source: "memory",
  };
}

export async function getCelestialStats(): Promise<{
  stats: CelestialStats;
  source: StatsSource;
}> {
  const redis = getRedisClient();

  if (redis) {
    const stats = await redis.hgetall<CelestialStats>(CELESTIAL_STATS_KEY);
    return {
      stats: stats || { total: 0, galaxy: 0, black_hole: 0, neutron_star: 0 },
      source: "upstash",
    };
  }

  return {
    stats: { ...memoryCelestialStats },
    source: "memory",
  };
}
