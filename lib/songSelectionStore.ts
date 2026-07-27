import { Redis } from "@upstash/redis";

/**
 * Rolling song-selection log backing `pickWeightedSongSelection` in
 * app/api/analyze/route.ts (recency + frequency-share penalties).
 *
 * This app is deployed on Vercel serverless: a plain in-memory module-level
 * array resets on every cold start and is NOT shared across concurrent
 * instances, which defeats the frequency-share correction exactly when it
 * matters (production traffic, repeat "always picks the same famous track"
 * behavior). Upstash Redis (REST-based, no persistent TCP connection) is the
 * shared, serverless-friendly store for this rolling list.
 *
 * Falls back to a plain in-memory array when Upstash credentials aren't
 * configured (e.g. local dev before provisioning) so local dev keeps working
 * with zero required setup — this fallback has NO cross-instance memory in
 * production, so treat it as a dev convenience only.
 *
 * Env var names vary by Vercel Marketplace integration version — check both.
 */
const LIST_KEY = "galaxseea:song-selections";
/** Matches the "~50-entry frequency log" from the optimization plan; the
 *  recency penalty (see route.ts) only looks at the first ~12 of these. */
const MAX_LOG_LENGTH = 50;

export type SongSelectionSource = "upstash" | "memory";

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
      "[songSelectionStore] No Upstash credentials found (KV_REST_API_URL/TOKEN " +
        "or UPSTASH_REDIS_REST_URL/TOKEN) — falling back to an in-memory list. " +
        "This has no cross-instance memory in production; provision Upstash " +
        "(vercel install upstash or the dashboard Storage tab) before relying " +
        "on the song-variety fix in production.",
    );
  }
  return redisClient;
}

/** In-memory fallback list, most-recent-first. */
const memoryLog: string[] = [];

/** Returns the rolling selection log, most-recent-first, plus which backing
 *  store served it — log this in production to confirm Upstash is actually
 *  wired up rather than silently using the memory fallback. */
export async function getRecentSelections(): Promise<{
  trackIds: string[];
  source: SongSelectionSource;
}> {
  const client = getRedisClient();
  if (!client) {
    return { trackIds: [...memoryLog], source: "memory" };
  }
  try {
    const trackIds = await client.lrange<string>(LIST_KEY, 0, MAX_LOG_LENGTH - 1);
    return { trackIds, source: "upstash" };
  } catch (err) {
    console.error(
      "[songSelectionStore] Upstash read failed; falling back to memory",
      err,
    );
    return { trackIds: [...memoryLog], source: "memory" };
  }
}

/** Records a new selection at the head of the rolling log, capped at
 *  MAX_LOG_LENGTH entries. */
export async function recordSelection(trackId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    memoryLog.unshift(trackId);
    memoryLog.length = Math.min(memoryLog.length, MAX_LOG_LENGTH);
    return;
  }
  try {
    await client.lpush(LIST_KEY, trackId);
    await client.ltrim(LIST_KEY, 0, MAX_LOG_LENGTH - 1);
  } catch (err) {
    console.error(
      "[songSelectionStore] Upstash write failed; recording to memory only",
      err,
    );
    memoryLog.unshift(trackId);
    memoryLog.length = Math.min(memoryLog.length, MAX_LOG_LENGTH);
  }
}
