import { Redis } from "@upstash/redis";

/**
 * Constellation store — stores minimal universe summaries in Upstash Redis
 * so every completed reveal becomes a star in the shared public sky.
 *
 * Falls back to an in-memory array for local dev without Redis.
 */

export interface ConstellationStar {
  /** Short ID for the star (first 8 chars of a UUID). */
  id: string;
  vibe: string;
  celestialType: string;
  creatureKind: string;
  creatureName: string;
  primaryColor: string;
  secondaryColor: string;
  readingSnippet: string;
  songName: string;
  songArtist: string;
  /** Unix timestamp ms. */
  createdAt: number;
}

const LIST_KEY = "galaxseea:constellation";
const MAX_STARS = 500; // Keep the sky manageable

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

/** In-memory fallback. */
const memoryStars: ConstellationStar[] = [];

/** Store a new star in the constellation. */
export async function addStar(star: ConstellationStar): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    memoryStars.unshift(star);
    if (memoryStars.length > MAX_STARS) memoryStars.length = MAX_STARS;
    return;
  }
  try {
    await client.lpush(LIST_KEY, JSON.stringify(star));
    await client.ltrim(LIST_KEY, 0, MAX_STARS - 1);
  } catch (err) {
    console.error("[constellationStore] Redis write failed:", err);
    memoryStars.unshift(star);
    if (memoryStars.length > MAX_STARS) memoryStars.length = MAX_STARS;
  }
}

/** Get all stars in the constellation (newest first). */
export async function getStars(): Promise<ConstellationStar[]> {
  const client = getRedisClient();
  if (!client) return [...memoryStars];
  try {
    const raw = await client.lrange<string>(LIST_KEY, 0, MAX_STARS - 1);
    return raw.map((s) => {
      try { return JSON.parse(s) as ConstellationStar; }
      catch { return null; }
    }).filter((s): s is ConstellationStar => s !== null);
  } catch (err) {
    console.error("[constellationStore] Redis read failed:", err);
    return [...memoryStars];
  }
}
