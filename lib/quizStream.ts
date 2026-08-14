/**
 * Client-side SSE consumer for /api/generate-quiz.
 *
 * Mirrors `streamAnalyze` from lib/analyzeStream.ts: fetches the route with
 * `Accept: text/event-stream`, parses the Server-Sent Events stream, and
 * surfaces progress + final-result events via typed callbacks. Falls back to
 * plain JSON if the route returns a non-SSE response (older bundles, or any
 * error envelope) so the quiz page keeps working with the legacy contract.
 *
 * Wire format reminder:
 *   event: progress
 *   data: {"stage":"planning","completed":0,"total":8,"msElapsed":120}
 *
 *   event: result
 *   data: { "questions": [...], "pickedAngles": [...] }
 */

import type { QuizProgressEvent } from "@/lib/quizProgress";
import type { GeneratedQuiz } from "@/lib/quizPrefetch";

export interface QuizStreamHandlers {
  /** Called once per `event: progress`. */
  onProgress?: (event: QuizProgressEvent) => void;
  /** Called once with the final quiz payload. */
  onResult?: (quiz: GeneratedQuiz) => void;
  /** Called once if the stream ends with an `event: error` or any
   *  network/parse failure. */
  onError?: (message: string) => void;
}

/** POST /api/generate-quiz and consume its SSE stream. Handlers are called
 *  in arrival order; onProgress fires repeatedly, onResult / onError exactly
 *  once. Throws if the response is not OK and not parseable as an error
 *  envelope. */
export async function streamQuiz(
  payload: { avoidAngles: readonly string[]; language: unknown; nonce?: string },
  handlers: QuizStreamHandlers,
): Promise<void> {
  const response = await fetch("/api/generate-quiz", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      throw new Error(body.error || body.detail || `HTTP ${response.status}`);
    }
    // Legacy JSON success path: server didn't honor our Accept header.
    const quiz = (await response.json()) as GeneratedQuiz;
    handlers.onResult?.(quiz);
    return;
  }

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        parseAndDispatch(rawEvent);
      }
    }
    if (buffer.trim().length > 0) {
      parseAndDispatch(buffer);
    }
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err.message : "Stream failed");
    return;
  }

  function parseAndDispatch(rawEvent: string): void {
    let eventName = "";
    let dataLine = "";
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLine = dataLine
          ? `${dataLine}\n${line.slice(5).trimStart()}`
          : line.slice(5).trimStart();
      }
    }
    if (!eventName || !dataLine) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLine);
    } catch {
      handlers.onError?.(`Malformed SSE data for event "${eventName}"`);
      return;
    }
    if (eventName === "progress") {
      handlers.onProgress?.(parsed as QuizProgressEvent);
    } else if (eventName === "result") {
      handlers.onResult?.(parsed as GeneratedQuiz);
    } else if (eventName === "error") {
      const errObj = parsed as { message?: string };
      handlers.onError?.(errObj.message ?? "Server error");
    }
  }
}
