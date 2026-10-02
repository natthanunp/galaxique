import { getRedis, V2_PREFIX } from "@/lib/redis";

/** Daily operational counters (no personal data). Never throws. */
export function countMetric(field: string, by = 1): void {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return;
  }
  if (!redis) return;
  const key = `${V2_PREFIX}metrics:${new Date().toISOString().slice(0, 10)}`;
  redis.pipeline().hincrby(key, field, Math.round(by)).expire(key, 120 * 86_400).exec()
    .catch(() => {});
}

export function trackLlm(purpose: string, metrics: { status: string; elapsedMs: number; costUsd: number | null }): void {
  countMetric(`llm:${purpose}:count`);
  countMetric(`llm:${purpose}:ms`, metrics.elapsedMs);
  if (metrics.status === "failed") countMetric(`llm:${purpose}:failed`);
  if (metrics.costUsd) countMetric(`llm:${purpose}:cost_micro_usd`, metrics.costUsd * 1_000_000);
}
