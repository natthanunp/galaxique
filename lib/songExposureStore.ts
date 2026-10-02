import { getRedis, V2_PREFIX } from "@/lib/redis";
import type { Language } from "@/types/universe";

/**
 * Per-track exposure counters that decay over time, plus per-language
 * shortlist/selection tallies for coverage reports. Daily buckets keep writes
 * atomic (HINCRBY) and let old exposure fade without a rewrite job.
 */

const HALF_LIFE_DAYS = 14;
const WINDOW_DAYS = 42;
const BUCKET_TTL_SECONDS = (WINDOW_DAYS + 2) * 86_400;
const memory = new Map<string, Map<string, number>>();

const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const bucketKey = (date: string) => `${V2_PREFIX}exposure:${date}`;

function bump(key: string, field: string) {
  const map = memory.get(key) ?? new Map<string, number>();
  map.set(field, (map.get(field) ?? 0) + 1);
  memory.set(key, map);
}

/** Decayed selection count per track over the last six weeks. */
export async function getExposure(): Promise<Record<string, number>> {
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => day(i));
  const redis = getRedis();
  const buckets: (Record<string, number> | null)[] = redis
    ? await (() => {
        const pipeline = redis.pipeline();
        for (const date of dates) pipeline.hgetall(bucketKey(date));
        return pipeline.exec<(Record<string, number> | null)[]>();
      })()
    : dates.map((date) => Object.fromEntries(memory.get(bucketKey(date)) ?? []));
  const exposure: Record<string, number> = {};
  buckets.forEach((bucket, age) => {
    const weight = 0.5 ** (age / HALF_LIFE_DAYS);
    for (const [trackId, count] of Object.entries(bucket ?? {})) {
      exposure[trackId] = (exposure[trackId] ?? 0) + Number(count) * weight;
    }
  });
  return exposure;
}

export async function recordSelection(trackId: string, language: Language, shortlistIds: readonly string[]) {
  const redis = getRedis();
  const exposureKey = bucketKey(day());
  const selectedKey = `${V2_PREFIX}selected:${language}`;
  const shortlistKey = `${V2_PREFIX}shortlist:${language}`;
  if (!redis) {
    bump(exposureKey, trackId);
    bump(selectedKey, trackId);
    for (const id of shortlistIds) bump(shortlistKey, id);
    return;
  }
  const pipeline = redis.pipeline();
  pipeline.hincrby(exposureKey, trackId, 1);
  pipeline.expire(exposureKey, BUCKET_TTL_SECONDS);
  pipeline.hincrby(selectedKey, trackId, 1);
  for (const id of shortlistIds) pipeline.hincrby(shortlistKey, id, 1);
  await pipeline.exec();
}
