import { readFileSync, existsSync } from "node:fs";
import { Redis } from "@upstash/redis";

const STATS_KEY = "galaxseea:vibe-stats";

function loadEnvFiles() {
  for (const file of [".env.local", ".env", ".env.production", ".env.development"]) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles();

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error("❌ No Upstash Redis credentials found.");
  console.error("   Set KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).");
  process.exit(1);
}

const redis = new Redis({ url, token });

console.log(`🧹 Deleting Redis key: ${STATS_KEY}`);
const deleted = await redis.del(STATS_KEY);

if (deleted === 1) {
  console.log("✅ Vibe stats cleared.");
} else if (deleted === 0) {
  console.log("ℹ️  Key did not exist (already empty).");
} else {
  console.log(`ℹ️  Redis response: ${deleted}`);
}
