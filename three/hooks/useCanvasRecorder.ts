"use client";

import { useCallback, useRef, useState } from "react";

interface UseCanvasRecorderOptions {
  /** Recording duration in milliseconds. */
  durationMs?: number;
  /** Frames per second captured from the canvas stream. */
  fps?: number;
  /** Mime type for the recorded webm. */
  mimeType?: string;
}

interface UseCanvasRecorderResult {
  /** True while a recording is in progress. */
  recording: boolean;
  /** Progress 0..1 of the current recording. */
  progress: number;
  /** Start recording the given canvas; resolves with a video Blob (webm on
   *  Chrome/Firefox, mp4 on Safari — see pickMime). Optionally mixes in an
   *  audio track (e.g. the Spotify preview, decoded via Web Audio API) and
   *  fires `onStart` at the exact moment recording begins, so callers can
   *  start audio playback in sync. */
  record: (
    canvas: HTMLCanvasElement | null,
    options?: { audioStream?: MediaStream | null; onStart?: () => void },
  ) => Promise<Blob>;
  /** Cancel an in-progress recording. */
  cancel: () => void;
}

/**
 * Records a Three.js <canvas> to a video Blob via MediaRecorder +
 * canvas.captureStream(). Chrome/Firefox produce webm (later transcoded to
 * mp4 by useMp4Exporter); Safari doesn't support MediaRecorder's webm codecs
 * at all, so we fall back to recording mp4/H.264 directly there.
 * `preserveDrawingBuffer: true` must be set on the GL context (it is, in
 * UniverseCanvas).
 */
export function useCanvasRecorder({
  durationMs = 12000,
  fps = 30,
  mimeType,
}: UseCanvasRecorderOptions = {}): UseCanvasRecorderResult {
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const cancelRef = useRef(false);

  const pickMime = useCallback((): string => {
    const candidates = [
      mimeType,
      // Video-only codecs — the app deliberately records without audio
      // (see ShareButton: "The final MP4 deliberately has no audio").
      // Including ",opus" in the codec string while the MediaStream has
      // no audio track causes Firefox's MediaRecorder to produce a
      // malformed WebM container that ffmpeg.wasm cannot demux. Chrome
      // tolerates the mismatch, but Firefox does not.
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      // Safari has NEVER supported MediaRecorder with any webm codec — it
      // only records H.264/AAC mp4. Without this fallback, `new
      // MediaRecorder(...)` throws synchronously on iOS/macOS Safari and the
      // whole export silently "doesn't work".
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
        return c;
      }
    }
    return "video/webm";
  }, [mimeType]);

  const record = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      options?: { audioStream?: MediaStream | null; onStart?: () => void },
    ): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        try {
          if (!canvas) {
            reject(new Error("No canvas provided."));
            return;
          }
          if (typeof MediaRecorder === "undefined") {
            reject(new Error("MediaRecorder is not supported in this browser."));
            return;
          }

          cancelRef.current = false;
          chunksRef.current = [];

          const videoStream = canvas.captureStream(fps);
          const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
          if (options?.audioStream) {
            tracks.push(...options.audioStream.getAudioTracks());
          }
          const combinedStream = new MediaStream(tracks);

          const recorder = new MediaRecorder(combinedStream, {
            mimeType: pickMime(),
            videoBitsPerSecond: 15_000_000,
          });
          recorderRef.current = recorder;

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.onstop = () => {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            const type = recorder.mimeType || "video/webm";
            const blob = new Blob(chunksRef.current, { type });
            chunksRef.current = [];
            setRecording(false);
            setProgress(0);
            if (cancelRef.current) {
              reject(new Error("Recording cancelled."));
            } else {
              resolve(blob);
            }
          };
          recorder.onerror = (e) => {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setRecording(false);
            setProgress(0);
            reject(new Error("MediaRecorder error: " + String(e)));
          };

          recorder.start();
          options?.onStart?.();
          setRecording(true);
          startTimeRef.current = performance.now();

          // Tick progress and auto-stop at durationMs.
          timerRef.current = setInterval(() => {
            const elapsed = performance.now() - startTimeRef.current;
            const p = Math.min(1, elapsed / durationMs);
            setProgress(p);
            if (p >= 1 && recorder.state !== "inactive") {
              recorder.stop();
            }
          }, 100);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    [durationMs, fps, pickMime],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      r.stop();
    }
  }, []);

  return { recording, progress, record, cancel };
}
