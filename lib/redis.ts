import { Redis } from "@upstash/redis";

/** Namespace for data written by the revamp; legacy keys stay under `galaxseea:`. */
export const V2_PREFIX = "galaxseea:v2:";

let client: Redis | null | undefined;

/** Shared Upstash client. Returns null only outside production (local dev). */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  if (!client && process.env.VERCEL_ENV === "production") {
    throw new Error("Redis credentials are required in production.");
  }
  return client;
}
