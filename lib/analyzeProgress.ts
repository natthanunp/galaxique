/**
 * Server-Sent Events helpers for /api/analyze.
 *
 * The route emits progress milestones while it works (Spotify fetch,
 * biased sampler, LLM call, picker) and the final reveal as a single
 * `event: result` message. Server-side latency is unchanged — this is
 * pure UX plumbing that lets the client animate a multi-stage loading
 * story instead of staring at one spinner for ~7 s.
 *
 * Wire format (one event per line, separated by blank lines):
 *
 *   event: progress
 *   data: {"stage":"starting","msElapsed":0}
 *
 *   event: progress
 *   data: {"stage":"llm","attempt":1,"msElapsed":420}
 *
 *   event: result
 *   data: { ...UniverseReveal... }
 *
 * Each `data:` line is a self-contained JSON object so consumers can
 * `JSON.parse` per line without buffering.
 */

export type AnalyzeStage =
  | "starting"
  | "spotify"
  | "enrich"
  | "llm"
  | "picker"
  | "done";

export interface AnalyzeProgressEvent {
  stage: AnalyzeStage;
  /** Milliseconds elapsed since the route started. Approximate but useful
   *  for showing "X seconds in" if the client wants to surface it. */
  msElapsed: number;
  /** LLM retry attempt (1 or 2). Only present for stage="llm". */
  attempt?: number;
  /** Number of catalog candidates sampled. Only present for stage="enrich". */
  sampledCount?: number;
}

export type ProgressCallback = (event: AnalyzeProgressEvent) => void;

/** Formats one SSE event block per the wire format above. */
function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Encodes a stream of progress events plus a final result as an SSE
 *  ReadableStream. The returned stream emits `event: progress` for each
 *  callback invocation and `event: result` exactly once with the final
 *  payload. Caller passes the underlying promise so the stream can resolve
 *  it lazily — no buffering, no double-await. */
export function sseStream(
  work: (progress: ProgressCallback) => Promise<unknown>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const requestStart = Date.now();
  // Capture the controller in start() so the progress closure can write
  // to it mid-flight. Null-safe enqueue() covers the brief window before
  // the consumer starts pulling (Next.js's RSC runtime pulls immediately,
  // but this is cheap insurance against any consumer that defers).
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  const progress: ProgressCallback = (event) => {
    // Stamp the actual wall-clock elapsed time at emit time, not the
    // placeholder the route's call sites pass. The route fires the
    // callback right after each phase boundary, so this gives the client
    // a believable "X seconds in" without the route having to track the
    // start time itself.
    const enriched: AnalyzeProgressEvent = {
      ...event,
      msElapsed: Date.now() - requestStart,
    };
    controllerRef?.enqueue(encoder.encode(formatSseEvent("progress", enriched)));
  };
  void work(progress)
    .then((result) => {
      controllerRef?.enqueue(encoder.encode(formatSseEvent("result", result)));
      controllerRef?.close();
    })
    .catch((err: Error) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      controllerRef?.enqueue(
        encoder.encode(
          formatSseEvent("error", {
            message,
            msElapsed: Date.now() - requestStart,
          }),
        ),
      );
      controllerRef?.close();
    });
  return stream;
}

/** Heuristic: does this request accept SSE? We treat the explicit
 *  `text/event-stream` Accept as the opt-in. Without it we still emit a
 *  normal JSON response so existing clients (e.g. the benchmark script)
 *  keep working unchanged. */
export function wantsEventStream(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}