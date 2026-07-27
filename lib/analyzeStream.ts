/**
 * Client-side SSE consumer for /api/analyze.
 *
 * Fetches the route with `Accept: text/event-stream`, parses the resulting
 * Server-Sent Events stream, and surfaces progress + final-result events
 * via a typed callback. Falls back to plain JSON if the route returns a
 * non-SSE response (older bundles, or any error envelope).
 *
 * Wire format reminder:
 *   event: progress
 *   data: {"stage":"llm","attempt":1,"msElapsed":4200}
 *
 *   event: result
 *   data: { ...UniverseReveal... }
 */

import type { AnalyzeProgressEvent } from "@/lib/analyzeProgress";
import type { UniverseReveal } from "@/types/universe";

export interface AnalyzeStreamHandlers {
  /** Called once per `event: progress`. */
  onProgress?: (event: AnalyzeProgressEvent) => void;
  /** Called once with the final `UniverseReveal` payload. */
  onResult?: (reveal: UniverseReveal) => void;
  /** Called once if the stream ends with an `event: error` or any
   *  network/parse failure. */
  onError?: (message: string) => void;
}

/** POST /api/analyze and consume its SSE stream. The handlers are called
 *  in arrival order; onProgress fires repeatedly, onResult / onError
 *  exactly once. Throws if the response is not OK and not parseable as
 *  an error envelope (treated as a hard failure). */
export async function streamAnalyze(
  payload: { answers: unknown; language?: unknown; recentTrackIds?: unknown },
  handlers: AnalyzeStreamHandlers,
): Promise<void> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Opt in to SSE. Without this header, the route falls back to JSON
      // and we'd parse the body as a single reveal — see the fallback
      // path at the bottom of this function.
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  // Non-SSE response: either an error envelope (503/502/500) or the
  // legacy JSON path returning a single reveal. Detect by content-type
  // and dispatch.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      throw new Error(body.error || body.detail || `HTTP ${response.status}`);
    }
    // Legacy JSON success path: server didn't honor our Accept header,
    // treat the body as a single reveal.
    const reveal = (await response.json()) as UniverseReveal;
    handlers.onResult?.(reveal);
    return;
  }

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE spec: events are separated by a blank line ("\n\n"); within an
  // event, lines beginning with "event:" set the event name and "data:"
  // carries the payload. We parse line-by-line into (event, data) pairs
  // and dispatch on blank-line boundaries.
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
    // Drain any trailing event that wasn't followed by a blank line.
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
        // SSE allows multi-line data; concatenate with newlines between
        // data: lines, matching the server format.
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
      handlers.onProgress?.(parsed as AnalyzeProgressEvent);
    } else if (eventName === "result") {
      handlers.onResult?.(parsed as UniverseReveal);
    } else if (eventName === "error") {
      const errObj = parsed as { message?: string };
      handlers.onError?.(errObj.message ?? "Server error");
    }
  }
}