/**
 * Server-Sent Events helpers for /api/generate-quiz.
 *
 * Mirrors the analyze route's progress streaming: the server emits milestone
 * events while it works (planning → writing n/total) and the final quiz as a
 * single `event: result` message. Server-side latency is unchanged — this is
 * pure UX plumbing that lets the /quiz loading screen show "AI is working"
 * beats instead of one static spinner for the full wait.
 *
 * Wire format (one event per line, separated by blank lines):
 *
 *   event: progress
 *   data: {"stage":"planning","completed":0,"total":8,"msElapsed":120}
 *
 *   event: progress
 *   data: {"stage":"writing","completed":3,"total":8,"msElapsed":1800}
 *
 *   event: result
 *   data: { "questions": [...], "pickedAngles": [...] }
 *
 * Each `data:` line is a self-contained JSON object so consumers can
 * `JSON.parse` per line without buffering.
 */

export type QuizStage = "planning" | "writing";

export interface QuizProgressEvent {
  stage: QuizStage;
  /** Milliseconds elapsed since the route started (stamped server-side). */
  msElapsed: number;
  /** Questions written so far (0 during "planning"). */
  completed: number;
  /** Total question count for the batch. */
  total: number;
  /** A short human "AI is thinking about X" phrase in the request's language.
   *  Derived from the planner's per-question scene anchor — no extra LLM call,
   *  just surfacing an artifact the model already produced. */
  thought?: string;
}

/** Progress callback passed into the generation worker. `msElapsed` is
 *  stamped by the stream helper, so callers omit it. */
export type QuizProgressCallback = (event: Omit<QuizProgressEvent, "msElapsed">) => void;

/** Encodes a stream of progress events plus a final result as an SSE
 *  ReadableStream. The returned stream emits `event: progress` for each
 *  callback invocation and `event: result` exactly once with the final
 *  payload. Caller passes the underlying promise so the stream can resolve
 *  it lazily — no buffering, no double-await. */
export function quizSseStream(
  work: (progress: QuizProgressCallback) => Promise<unknown>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const requestStart = Date.now();
  // Release the controller on cancellation and completion; late worker events are ignored.
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      controllerRef = null;
    },
  });

  const progress: QuizProgressCallback = (event) => {
    const enriched: QuizProgressEvent = {
      ...event,
      msElapsed: Date.now() - requestStart,
    };
    controllerRef?.enqueue(
      encoder.encode(
        `event: progress\ndata: ${JSON.stringify(enriched)}\n\n`,
      ),
    );
  };

  void Promise.resolve().then(() => work(progress))
    .then((result) => {
      controllerRef?.enqueue(
        encoder.encode(`event: result\ndata: ${JSON.stringify(result)}\n\n`),
      );
      controllerRef?.close();
      controllerRef = null;
    })
    .catch((err: Error) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      controllerRef?.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({
            message,
            msElapsed: Date.now() - requestStart,
          })}\n\n`,
        ),
      );
      controllerRef?.close();
      controllerRef = null;
    });
  return stream;
}
