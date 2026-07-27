"use client";

import type { QuizQuestion } from "@/types/universe";

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

function getAvoidAnglesKey(avoidAngles: readonly string[]): string {
  return JSON.stringify(avoidAngles);
}

async function requestQuiz(avoidAngles: readonly string[]): Promise<GeneratedQuiz> {
  const response = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avoidAngles, nonce: crypto.randomUUID() }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed (${response.status})`);
  }
  return response.json() as Promise<GeneratedQuiz>;
}

/** Begin the next quiz's request before navigation. Callers with matching
 *  angle history can later consume this exact promise rather than re-fetch. */
export function prefetchQuiz(
  avoidAngles: readonly string[],
): Promise<GeneratedQuiz> {
  const avoidAnglesKey = getAvoidAnglesKey(avoidAngles);
  const now = Date.now();
  if (
    prefetchedQuiz &&
    prefetchedQuiz.avoidAnglesKey === avoidAnglesKey &&
    now - prefetchedQuiz.createdAt < PREFETCH_TTL_MS
  ) {
    return prefetchedQuiz.promise;
  }

  const promise = requestQuiz(avoidAngles);
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
): Promise<GeneratedQuiz> | undefined {
  const next = prefetchedQuiz;
  prefetchedQuiz = null;
  if (
    !next ||
    next.avoidAnglesKey !== getAvoidAnglesKey(avoidAngles) ||
    Date.now() - next.createdAt >= PREFETCH_TTL_MS
  ) {
    return undefined;
  }
  return next.promise;
}
