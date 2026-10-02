import { createHash } from "node:crypto";

import { getRedis, V2_PREFIX } from "@/lib/redis";

/** Hashed client IP; raw addresses are never stored. Vercel sets x-real-ip. */
export function clientKey(request: Request): string {
  const ip = request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return createHash("sha256").update(`galaxique-rl:${ip}`).digest("hex").slice(0, 32);
}

const memory = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window limiter. Fails open on storage errors so an outage never blocks visitors. */
export async function rateLimit(
  scope: string,
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const key = `${V2_PREFIX}rl:${scope}:${id}`;
  const redis = getRedis();
  if (!redis) {
    const now = Date.now();
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { ok: true, retryAfter: 0 };
    }
    entry.count++;
    return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    if (count <= limit) return { ok: true, retryAfter: 0 };
    const ttl = await redis.ttl(key);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    console.error("[rateLimit] storage error", { scope, name: (error as Error)?.name });
    return { ok: true, retryAfter: 0 };
  }
}

export function tooManyRequests(retryAfter: number): Response {
  return Response.json(
    { success: false, error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
