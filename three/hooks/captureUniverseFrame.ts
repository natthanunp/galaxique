"use client";

/** One-shot requests are fulfilled after the postprocessing render, before WebGL
 * clears its non-preserved drawing buffer. No continuous GPU readback or stream. */
type Capture = () => Promise<ImageBitmap>;
const captures = new WeakMap<HTMLCanvasElement, Capture>();
export function registerFrameCapture(canvas: HTMLCanvasElement, capture: Capture) {
  captures.set(canvas, capture);
  return () => { captures.delete(canvas); };
}
export function captureUniverseFrame(canvas: HTMLCanvasElement) {
  return captures.get(canvas)?.() ?? Promise.reject(new Error('The universe frame capture is not ready.'));
}
