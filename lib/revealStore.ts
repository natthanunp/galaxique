import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getRedis, V2_PREFIX } from "@/lib/redis";
import type { Language, UniverseReveal } from "@/types/universe";

/**
 * Private, server-held copy of each reveal so features like creature chat
 * read world data from the server instead of trusting the client. Access
 * needs the random token returned once to the creator; only its hash is kept.
 */

export interface StoredReveal {
  reveal: UniverseReveal;
  language: Language;
  isrc?: string | null;
  song?: { name: string; artist: string };
  tokenHash: string;
  createdAt: number;
}

const TTL_SECONDS = 180 * 24 * 60 * 60;
const memory = new Map<string, StoredReveal>();

const key = (revealId: string) => `${V2_PREFIX}reveal:${revealId}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Stores the reveal and returns its access token. */
export async function saveReveal(
  reveal: UniverseReveal,
  language: Language,
  extra: { isrc?: string | null; song?: { name: string; artist: string } } = {},
): Promise<string> {
  if (!reveal.reveal_id) throw new Error("reveal_id is required.");
  const token = randomBytes(24).toString("base64url");
  const record: StoredReveal = { reveal, language, isrc: extra.isrc ?? null, song: extra.song, tokenHash: hashToken(token), createdAt: Date.now() };
  const redis = getRedis();
  if (redis) await redis.set(key(reveal.reveal_id), record, { ex: TTL_SECONDS });
  else memory.set(reveal.reveal_id, record);
  return token;
}

/** Returns the stored reveal only when the token matches. */
export async function loadReveal(revealId: string, token: string): Promise<StoredReveal | null> {
  const redis = getRedis();
  const record = redis ? await redis.get<StoredReveal>(key(revealId)) : memory.get(revealId) ?? null;
  if (!record) return null;
  const expected = Buffer.from(record.tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? record : null;
}
