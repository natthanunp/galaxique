import { randomUUID } from "node:crypto";

import { generateBalancedQuiz } from "@/lib/quiz";
import type { QuizProgressCallback, QuizProgressEvent } from "@/lib/quizProgress";
import type { Language } from "@/types/universe";

export interface QuizJobInput {
  avoidAngles: string[];
  language: Language;
  nonce?: string;
}

interface QuizJob {
  promise: ReturnType<typeof generateBalancedQuiz>;
  subscribers: Set<QuizProgressCallback>;
  latestProgress?: Omit<QuizProgressEvent, "msElapsed">;
}

const inFlightQuizJobs = new Map<string, QuizJob>();

function normalizeAngleHistory(angles: readonly string[]): string[] {
  return [...new Set(angles
    .map((angle) => angle.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean))]
    .sort();
}

function quizJobKey(input: Required<Pick<QuizJobInput, "nonce" | "language">> & Pick<QuizJobInput, "avoidAngles">): string {
  return JSON.stringify({
    nonce: input.nonce.trim(),
    language: input.language.toLowerCase(),
    avoidAngles: normalizeAngleHistory(input.avoidAngles),
  });
}

/**
 * Share an entire in-flight generation job between matching JSON and SSE
 * requests. Only work in progress is retained; the entry is deleted as soon
 * as it settles, so this is not a completed-result cache.
 */
export function runSharedQuizJob(
  input: QuizJobInput,
  progress: QuizProgressCallback,
): ReturnType<typeof generateBalancedQuiz> {
  const normalizedInput = {
    language: input.language,
    avoidAngles: normalizeAngleHistory(input.avoidAngles),
    nonce: input.nonce?.trim() || randomUUID(),
  };
  const key = quizJobKey(normalizedInput);
  const existing = inFlightQuizJobs.get(key);
  if (existing) {
    existing.subscribers.add(progress);
    if (existing.latestProgress) progress(existing.latestProgress);
    return existing.promise.finally(() => existing.subscribers.delete(progress));
  }

  const job = {
    subscribers: new Set<QuizProgressCallback>([progress]),
  } as QuizJob;
  // Defer the worker by one microtask so the job is installed before its
  // synchronous planning progress event fires.
  const work = Promise.resolve().then(() => generateBalancedQuiz(
    normalizedInput,
    (event) => {
      job.latestProgress = event;
      for (const subscriber of job.subscribers) {
        try {
          subscriber(event);
        } catch {
          // A disconnected progress subscriber must not cancel shared work.
        }
      }
    },
  ));
  job.promise = work.finally(() => {
    if (inFlightQuizJobs.get(key) === job) inFlightQuizJobs.delete(key);
    job.subscribers.clear();
  });
  inFlightQuizJobs.set(key, job);
  return job.promise.finally(() => job.subscribers.delete(progress));
}

/** Test/diagnostic visibility without exposing job contents. */
export function activeQuizJobCount(): number {
  return inFlightQuizJobs.size;
}
