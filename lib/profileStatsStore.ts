import { Redis } from "@upstash/redis";
import { z } from "zod";
import { CELESTIAL_TYPES, THEMES, THEME_VIBE } from "@/lib/profile";

export const profileStatSchema = z.object({
  profile_version: z.literal(2), reveal_id: z.string().uuid(), theme: z.enum(THEMES),
  vibe: z.enum(["cute", "cozy", "mysterious", "intense", "whimsical", "cynical"]),
  celestial_type: z.enum(CELESTIAL_TYPES), language: z.enum(["en", "th"]),
}).refine(x => THEME_VIBE[x.theme] === x.vibe, "Theme and rendering key do not match");
const PREFIX = "galaxseea:profile-v2";
const emptyStats = () => Object.fromEntries(["total", ...THEMES].map(k => [k, 0])) as Record<string, number>;
const memory = emptyStats();
const counted = new Set<string>();
const daily = new Map<string, Record<string, number>>();
function client() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}
/** Atomic deduplication and both counters; no reads or writes to legacy Redis keys. */
export async function incrementProfileStat(raw: z.infer<typeof profileStatSchema>) {
  const input = profileStatSchema.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const combo = `${input.theme}:${input.celestial_type}`;
  const db = client();
  if (db) {
    await db.eval(`
      if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then return 0 end
      redis.call('HINCRBY', KEYS[2], 'total', 1)
      redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
      redis.call('HINCRBY', KEYS[2], ARGV[3], 1)
      redis.call('HINCRBY', KEYS[3], ARGV[4], 1)
      return 1
    `, [`${PREFIX}:counted`, `${PREFIX}:stats`, `${PREFIX}:daily:${date}`], [input.reveal_id, input.theme, combo, `${input.language}:${combo}`]);
  } else if (!counted.has(input.reveal_id)) {
    counted.add(input.reveal_id);
    memory.total++;
    memory[input.theme]++;
    memory[combo] = (memory[combo] ?? 0) + 1;
    const day = daily.get(date) ?? {};
    const key = `${input.language}:${combo}`;
    day[key] = (day[key] ?? 0) + 1;
    daily.set(date, day);
  }
  return getProfileStats();
}
export async function getProfileStats() {
  const db = client();
  if (db) return { stats: { ...emptyStats(), ...await db.hgetall<Record<string, number>>(`${PREFIX}:stats`) }, source: "upstash" as const };
  return { stats: { ...memory }, source: "memory" as const };
}
