"use client";

import type { Language, QuizQuestion } from "@/types/universe";

export interface GeneratedQuiz {
  questions: QuizQuestion[];
  pickedAngles?: string[];
}

interface PrefetchedQuiz {
  avoidAnglesKey: string;
  createdAt: number;
  promise: Promise<GeneratedQuiz>;
}

const PREFETCH_TTL_MS = 2 * 60 * 1000;
let prefetchedQuiz: PrefetchedQuiz | null = null;

function getAvoidAnglesKey(avoidAngles: readonly string[], language: Language): string {
  return JSON.stringify({ avoidAngles, language });
}

async function requestQuiz(
  avoidAngles: readonly string[],
  language: Language,
): Promise<GeneratedQuiz> {
  const response = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avoidAngles, language, nonce: generateNonce() }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed (${response.status})`);
  }
  return response.json() as Promise<GeneratedQuiz>;
}

/** Generate a unique request nonce. Prefers `crypto.randomUUID` (available
 *  in secure contexts: HTTPS, localhost) but falls back to a Math.random-
 *  based UUID-shaped string for non-secure contexts like a phone on the
 *  same Wi-Fi accessing `http://<laptop-ip>:3000` — otherwise the quiz
 *  request throws `crypto.randomUUID is not a function` on the very first
 *  attempt. Uniqueness (not cryptographic strength) is all the server-side
 *  in-flight dedup needs; collisions are vanishingly unlikely with 32
 *  hex chars of entropy either way. */
function generateNonce(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // RFC 4122 v4-ish shape from two Math.random calls. Good enough for the
  // request-dedupe key (collision odds per pair ≈ 1e-19).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Begin the next quiz's request before navigation. Callers with matching
 *  angle history can later consume this exact promise rather than re-fetch. */
export function prefetchQuiz(
  avoidAngles: readonly string[],
  language: Language,
): Promise<GeneratedQuiz> {
  const avoidAnglesKey = getAvoidAnglesKey(avoidAngles, language);
  const now = Date.now();
  if (
    prefetchedQuiz &&
    prefetchedQuiz.avoidAnglesKey === avoidAnglesKey &&
    now - prefetchedQuiz.createdAt < PREFETCH_TTL_MS
  ) {
    return prefetchedQuiz.promise;
  }

  const promise = requestQuiz(avoidAngles, language);
  const next = { avoidAnglesKey, createdAt: now, promise };
  prefetchedQuiz = next;
  void promise.catch(() => {
    if (prefetchedQuiz === next) prefetchedQuiz = null;
  });
  return promise;
}

/** Return a compatible, short-lived prefetch once. The caller owns the promise
 *  after consuming it, so retries will always make a genuinely new request. */
export function takePrefetchedQuiz(
  avoidAngles: readonly string[],
  language: Language,
): Promise<GeneratedQuiz> | undefined {
  const next = prefetchedQuiz;
  prefetchedQuiz = null;
  if (
    !next ||
    next.avoidAnglesKey !== getAvoidAnglesKey(avoidAngles, language) ||
    Date.now() - next.createdAt >= PREFETCH_TTL_MS
  ) {
    return undefined;
  }
  return next.promise;
}
