import { Redis } from "@upstash/redis";

/**
 * Read-only access to the legacy constellation feed (`galaxseea:constellation`).
 * Those summaries were stored without publishing consent, so callers only get
 * decorative fields. New public worlds will live in a separate, opt-in store.
 */

interface LegacyRecord {
  id?: string;
  primaryColor?: string;
  celestialType?: string;
}

/** Decorative, non-selectable star: no ID, text, creature, or song. */
export interface LegacyStar {
  /** Stable placement seed derived from the record; not reversible to its ID. */
  seed: number;
  color: string;
  celestialType: "galaxy" | "black_hole" | "neutron_star";
}

const LIST_KEY = "galaxseea:constellation";
const MAX_STARS = 500;
const HEX = /^#[0-9a-f]{6}$/i;
const TYPES = new Set(["galaxy", "black_hole", "neutron_star"]);

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

function seedOf(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function getLegacyStars(): Promise<LegacyStar[]> {
  const client = getRedisClient();
  if (!client) return [];
  const raw = await client.lrange<string | LegacyRecord>(LIST_KEY, 0, MAX_STARS - 1);
  return raw.flatMap((entry, index) => {
    let record: LegacyRecord;
    try {
      record = typeof entry === "string" ? JSON.parse(entry) : entry;
    } catch {
      return [];
    }
    return [{
      seed: seedOf(`${record.id ?? index}`),
      color: record.primaryColor && HEX.test(record.primaryColor) ? record.primaryColor : "#9fb4ff",
      celestialType: (record.celestialType && TYPES.has(record.celestialType)
        ? record.celestialType
        : "galaxy") as LegacyStar["celestialType"],
    }];
  });
}
