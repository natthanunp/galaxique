import { Redis } from "@upstash/redis";

/**
 * Real-time vibe statistics for the landing page counter.
 * Tracks total universe reveals and per-vibe counts.
 *
 * Uses the same Upstash Redis instance as songSelectionStore.
 * Falls back to in-memory storage when credentials aren't configured.
 */

const STATS_KEY = "galaxseea:vibe-stats";

export type VibeStats = {
  total: number;
  cute: number;
  cozy: number;
  mysterious: number;
  intense: number;
  whimsical: number;
  cynical: number;
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
