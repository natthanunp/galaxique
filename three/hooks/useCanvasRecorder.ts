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
 * Direct `captureStream()` does not require WebGL's costly
 * `preserveDrawingBuffer` option.
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
    // Prefer recording H.264 MP4 directly whenever the browser supports
    // it — including Chrome. An MP4 source lets useMp4Exporter do a
    // near-instant `-c copy` remux instead of a full libx264 transcode.
    // The transcode path is only fast on a cross-origin-isolated page
    // (multi-threaded core), but real-world Safari/Android-browser tabs
    // are usually NOT isolated → single-threaded core → libx264 at
    // 1080x1920 runs <1 fps and the export looks "stuck". Recording MP4
    // sidesteps the transcode entirely, on any core, exactly like Safari
    // always has. (WebM is kept as a fallback for browsers that don't
    // expose MP4 recording — older Firefox, some WebViews.)
    const candidates = [
      mimeType,
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      // WebM fallbacks — only used when the browser can't record MP4.
      // Video-only: the app records without audio (see ShareButton), and
      // including ",opus" while the MediaStream has no audio track makes
      // Firefox's MediaRecorder emit a malformed WebM that ffmpeg.wasm
      // can't demux (Chrome tolerates the mismatch).
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
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

          // 720x1280 mobile exports have 56% fewer pixels than the desktop
          // 1080x1920 profile, so 4 Mbps preserves the same visual density
          // while giving the device encoder enough headroom for 30fps.
          const videoBitsPerSecond = canvas.width <= 720 || canvas.height <= 1280
            ? 4_000_000
            : 6_000_000;
          console.log("[export] recorder config", {
            width: canvas.width,
            height: canvas.height,
            fps,
            videoBitsPerSecond,
          });
          const recorder = new MediaRecorder(combinedStream, {
            mimeType: pickMime(),
            videoBitsPerSecond,
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
