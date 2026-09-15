"use client";

import type { Language } from "@/types/universe";

interface ActiveNonce {
  nonce: string;
  createdAt: number;
}

const NONCE_TTL_MS = 2 * 60 * 1000;
const activeNonces = new Map<string, ActiveNonce>();

function normalizedRequestKey(avoidAngles: readonly string[], language: Language): string {
  const normalizedAngles = [...new Set(avoidAngles
    .map((angle) => angle.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean))]
    .sort();
  return JSON.stringify({ language: language.toLowerCase(), avoidAngles: normalizedAngles });
}

function generateNonce(): string {
  const cryptoApi = typeof globalThis !== "undefined"
    ? (globalThis.crypto as Crypto | undefined)
    : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Reuse one nonce for concurrent clients of the same logical request. */
export function acquireQuizRequestNonce(
  avoidAngles: readonly string[],
  language: Language,
  explicitRetry = false,
): string {
  const key = normalizedRequestKey(avoidAngles, language);
  const current = activeNonces.get(key);
  const now = Date.now();
  if (!explicitRetry && current && now - current.createdAt < NONCE_TTL_MS) {
    return current.nonce;
  }
  const nonce = generateNonce();
  activeNonces.set(key, { nonce, createdAt: now });
  return nonce;
}

export function releaseQuizRequestNonce(
  avoidAngles: readonly string[],
  language: Language,
  nonce: string,
): void {
  const key = normalizedRequestKey(avoidAngles, language);
  if (activeNonces.get(key)?.nonce === nonce) activeNonces.delete(key);
}
