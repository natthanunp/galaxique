"use client";

import { useCallback, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";

interface UseMp4ExporterResult {
  /** True while the ffmpeg core is loading (~31MB from CDN). */
  loadingCore: boolean;
  /** True while the webm→mp4 transcode is running. */
  transcoding: boolean;
  /** 0..1 transcode progress (experimental; may stay 0 for some inputs). */
  progress: number;
  /** Transcode a webm Blob to an mp4 Blob and trigger a download. */
  exportToMp4: (webm: Blob, filename?: string) => Promise<Blob>;
}

// MUST match the CORE_VERSION that the installed @ffmpeg/ffmpeg package was
// built against — its worker imports the core JS as a module and the two
// must speak the same ABI. As of @ffmpeg/ffmpeg@0.12.15 the bundled
// CORE_VERSION is 0.12.9 (see node_modules/@ffmpeg/ffmpeg/dist/esm/const.js).
// A mismatch silently throws "ErrnoError: FS error" from the virtual FS on
// writeFile/exec/readFile.
const CORE_VERSION = "0.12.9";
// Single-thread core (no SharedArrayBuffer / COOP-COEP headers required).
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

/**
 * Lazy ffmpeg.wasm transcoder: webm → mp4.
 *
 * The ~31MB core is fetched from jsdelivr via toBlobURL (to satisfy CORS) ONLY
 * on the first export click, then reused for subsequent exports. The resulting
 * mp4 is returned and auto-downloaded for IG Story sharing.
 */
export function useMp4Exporter(): UseMp4ExporterResult {
  const [loadingCore, setLoadingCore] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const ffmpegRef = useRef<InstanceType<typeof FFmpeg> | null>(null);

  const exportToMp4 = useCallback(
    async (webm: Blob, filename = "galaxique-universe.mp4"): Promise<Blob> => {
      // Lazy-load ffmpeg + core on first use.
      const { toBlobURL, fetchFile } = await import("@ffmpeg/util");

      let ffmpeg = ffmpegRef.current;

      if (!ffmpeg) {
        setLoadingCore(true);
        ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: p }) => {
          setProgress(Math.max(0, Math.min(1, p)));
        });
        ffmpeg.on("log", ({ message }) => {
          // Useful diagnostic surface for the rare case exec() resolves
          // on a non-zero ffmpeg exit. Kept always-on (one console line
          // per ffmpeg message) but stripped of any user-data.
          console.log("[ffmpeg]", message);
        });
        try {
          const coreURL = await toBlobURL(
            `${CORE_BASE}/ffmpeg-core.js`,
            "text/javascript",
          );
          const wasmURL = await toBlobURL(
            `${CORE_BASE}/ffmpeg-core.wasm`,
            "application/wasm",
          );
          await ffmpeg.load({ coreURL, wasmURL });
        } catch (err) {
          setLoadingCore(false);
          throw new Error(
            `ffmpeg load failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          );
        }
        ffmpegRef.current = ffmpeg;
        setLoadingCore(false);
      }

      setTranscoding(true);
      setProgress(0);

      // Safari's MediaRecorder records mp4/H.264 directly (it has no webm
      // support at all — see useCanvasRecorder's pickMime). In that case we
      // only need a fast remux (add faststart for IG/web playback) instead
      // of a full re-encode, which is both slower and lossy.
      const isAlreadyMp4 = webm.type.includes("mp4");
      const inputName = isAlreadyMp4 ? "input.mp4" : "input.webm";
      const outputName = "output.mp4";

      try {
        const fileBytes = await fetchFile(webm);
        await ffmpeg.writeFile(inputName, fileBytes);
      } catch (err) {
        throw new Error(
          `ffmpeg writeFile failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
      // Capture the last ffmpeg log line so we can surface the real error
      // if exec fails (ffmpeg.wasm's `exec()` resolves on a non-zero ffmpeg
      // exit code without throwing — so a silent "0-byte output" used to be
      // the only symptom of e.g. libx264 refusing an odd-dimension input).
      let lastFfmpegLine = "";
      const onLog = ({ message }: { message: string }) => {
        lastFfmpegLine = message;
      };
      ffmpeg.on("log", onLog);
      try {
        // libx264 requires even width AND height. The R3F canvas can
        // produce odd dimensions depending on DPR rounding (e.g. 985x538
        // on a 1.5x retina viewport), which used to fail the encode
        // silently. Round to the nearest even pair with a scale filter.
        await ffmpeg.exec(
          isAlreadyMp4
            ? [
                "-i",
                inputName,
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                outputName,
              ]
            : [
                "-i",
                inputName,
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                outputName,
              ],
        );
      } catch (err) {
        throw new Error(
          `ffmpeg exec failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)} (last ffmpeg log: ${lastFfmpegLine || "none"})`,
        );
      } finally {
        ffmpeg.off("log", onLog);
      }
      let data: Uint8Array;
      try {
        data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      } catch (err) {
        throw new Error(
          `ffmpeg readFile failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)} (last ffmpeg log: ${lastFfmpegLine || "none"})`,
        );
      }
      if (data.byteLength === 0) {
        // Defensive: ffmpeg.wasm's exec() resolves even on a non-zero ffmpeg
        // exit code, so a silent failure (e.g. encoder error, missing
        // codec) can produce a 0-byte output without throwing. If the
        // output is empty, surface the last ffmpeg log line so the user
        // can see what actually went wrong instead of "0 bytes".
        throw new Error(
          `ffmpeg produced an empty output (last ffmpeg log: ${lastFfmpegLine || "none"})`,
        );
      }
      // Copy into a fresh ArrayBuffer-backed Uint8Array so Blob accepts it
      // (ffmpeg returns a Uint8Array whose .buffer may be a SharedArrayBuffer).
      const mp4Bytes = new Uint8Array(data.byteLength);
      mp4Bytes.set(data);
      const mp4 = new Blob([mp4Bytes], { type: "video/mp4" });
      console.log("[debug] final mp4 blob size=", mp4.size);

      // Clean up the virtual FS.
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch {
        /* ignore cleanup errors */
      }

      setTranscoding(false);
      setProgress(0);

      // Trigger a download.
      const url = URL.createObjectURL(mp4);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke shortly after to let the download start.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      return mp4;
    },
    [],
  );

  return { loadingCore, transcoding, progress, exportToMp4 };
}
