import { Redis } from "@upstash/redis";

/**
 * Conversation history store for the creature chat feature.
 *
 * Stores the last N messages per user (keyed by a session ID stored in
 * localStorage) in Upstash Redis. Falls back to in-memory when Redis
 * isn't configured (local dev).
 */

export interface ChatMessage {
  role: "user" | "creature";
  content: string;
  timestamp: number;
}

const LIST_PREFIX = "galaxseea:chat:";
const MAX_MESSAGES = 20; // 10 exchanges
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

/** In-memory fallback for local dev. */
const memoryStore = new Map<string, ChatMessage[]>();

function listKey(sessionId: string): string {
  return `${LIST_PREFIX}${sessionId}`;
}

/** Get the conversation history for a session. */
export async function getConversationHistory(
  sessionId: string,
): Promise<ChatMessage[]> {
  const client = getRedisClient();
  if (!client) {
    return memoryStore.get(sessionId) ?? [];
  }
  try {
    const raw = await client.lrange<ChatMessage>(listKey(sessionId), 0, -1);
    return raw.reverse(); // stored newest-first, return oldest-first
  } catch (err) {
    console.error("[creatureChatStore] Redis read failed:", err);
    return memoryStore.get(sessionId) ?? [];
  }
}

/** Append a message to the conversation history. */
export async function appendMessage(
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    const list = memoryStore.get(sessionId) ?? [];
    list.push(message);
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    memoryStore.set(sessionId, list);
    return;
  }
  try {
    const key = listKey(sessionId);
    await client.lpush(key, JSON.stringify(message));
    await client.ltrim(key, 0, MAX_MESSAGES - 1);
    await client.expire(key, TTL_SECONDS);
  } catch (err) {
    console.error("[creatureChatStore] Redis write failed:", err);
    const list = memoryStore.get(sessionId) ?? [];
    list.push(message);
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    memoryStore.set(sessionId, list);
  }
}

/** Clear all conversation history for a session. Called when the user gets
 *  a new creature so the old creature's responses don't poison the new one. */
export async function clearHistory(sessionId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    memoryStore.delete(sessionId);
    return;
  }
  try {
    await client.del(listKey(sessionId));
  } catch (err) {
    console.error("[creatureChatStore] Redis delete failed:", err);
    memoryStore.delete(sessionId);
  }
}
