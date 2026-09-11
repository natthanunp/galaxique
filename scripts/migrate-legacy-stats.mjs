#!/usr/bin/env node

import nextEnv from "@next/env";
import { Redis } from "@upstash/redis";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error("No Upstash Redis credentials found.");
}

const redis = new Redis({ url, token });
const LEGACY_VIBE_KEY = "galaxseea:vibe-stats";
const LEGACY_CELESTIAL_KEY = "galaxseea:celestial-stats";
const PROFILE_STATS_KEY = "galaxseea:profile-v2:stats";
const MIGRATIONS_KEY = "galaxseea:profile-v2:migrations";
const MIGRATION_ID = "legacy-stats-v1";

// One atomic operation preserves existing v2 counts and prevents a retry from
// importing the legacy totals twice. The legacy hashes remain untouched as a
// recoverable backup.
const result = await redis.eval(
  `
    if redis.call("SISMEMBER", KEYS[4], ARGV[1]) == 1 then
      return {0, redis.call("HGET", KEYS[3], "total") or "0"}
    end

    local legacyTotal = tonumber(redis.call("HGET", KEYS[1], "total") or "0")
    redis.call("HINCRBY", KEYS[3], "total", legacyTotal)

    local vibeFields = {"cute", "cozy", "mysterious", "intense", "whimsical", "cynical"}
    local themeFields = {"affectionate", "grounded", "reflective", "driven", "imaginative", "questioning"}
    for index = 1, #vibeFields do
      local count = tonumber(redis.call("HGET", KEYS[1], vibeFields[index]) or "0")
      redis.call("HINCRBY", KEYS[3], themeFields[index], count)
    end

    local celestialFields = {"total", "galaxy", "black_hole", "neutron_star"}
    for index = 1, #celestialFields do
      local count = tonumber(redis.call("HGET", KEYS[2], celestialFields[index]) or "0")
      redis.call("HINCRBY", KEYS[3], "legacy:celestial:" .. celestialFields[index], count)
    end

    redis.call("SADD", KEYS[4], ARGV[1])
    return {1, redis.call("HGET", KEYS[3], "total") or "0"}
  `,
  [LEGACY_VIBE_KEY, LEGACY_CELESTIAL_KEY, PROFILE_STATS_KEY, MIGRATIONS_KEY],
  [MIGRATION_ID],
);

const [migrated, total] = result;
const stats = await redis.hgetall(PROFILE_STATS_KEY);

console.log(JSON.stringify({
  migration: MIGRATION_ID,
  applied: Number(migrated) === 1,
  total: Number(total),
  stats,
  legacyKeysPreserved: true,
}, null, 2));
