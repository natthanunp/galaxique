"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";

interface UseMp4ExporterOptions {
  /** Fired the moment ffmpeg's core finishes loading and the
   *  transcoder is about to start. Lets callers flip their UI from
   *  "Loading the local video converter…" to a transcode-specific
   *  label without polling `loadingCore`. Fires once per export; not
   *  fired when the core is already cached from a previous run. */
  onLoad?: () => void;
}

interface UseMp4ExporterResult {
  /** True while the ffmpeg core is loading (~31MB from CDN). */
  loadingCore: boolean;
  /** True while the webm→mp4 transcode is running. */
  transcoding: boolean;
  /** 0..1 transcode progress (experimental; may stay 0 for some inputs). */
  progress: number;
  /** Transcode a recorded video Blob to an mp4 Blob. */
  exportToMp4: (webm: Blob) => Promise<Blob>;
}

// Path inside the deployed app's /public directory where the postinstall
// script copies @ffmpeg/core's ESM build (ffmpeg-core.js +
// ffmpeg-core.wasm, ~31 MB) and the wrapper's own worker.js +
// const.js + errors.js. Same-origin serving keeps the 32 MB transfer
// inside Vercel's edge cache so the second user pays near-zero latency.
//
// The installed @ffmpeg/core version MUST match the wrapper's bundled
// CORE_VERSION (see @ffmpeg/ffmpeg/dist/esm/const.js).
// scripts/copy-ffmpeg-core.mjs refuses to copy if they disagree, so
// the build fails loudly instead of silently shipping an incompatible
// wasm.
//
// We try the multi-threaded core first (faster encode, runs libx264 across
// browser pthreads) and fall back to the single-threaded core if the
// document isn't cross-origin isolated. SharedArrayBuffer is gated behind
// the COOP/COEP headers on the document, so even if /reveal normally has
// them, edge cases (a proxied response that strips headers, a deployment
// behind a different domain, etc.) can leave the page un-isolated. Loading
// the multi-threaded core on such a page throws "SharedArrayBuffer is not
// defined" inside the worker; the single-threaded core doesn't need SAB
// and works in every browser, just slower.
const CORE_PATH_MT = "/ffmpeg-mt";
const CORE_PATH_ST = "/ffmpeg";
// This is @ffmpeg/ffmpeg's module worker, not the ffmpeg-core pthread
// worker. It stays with the wrapper assets in /ffmpeg/ and dynamically
// imports the chosen core at runtime.
const WRAPPER_WORKER_PATH = "/ffmpeg/ffmpeg-worker.js";

/**
 * Lazy ffmpeg.wasm transcoder: webm → mp4.
 *
 * The copy script ships two cooperating sets of files:
 *  - `/ffmpeg/ffmpeg-worker.js` plus its const/errors imports: the
 *    @ffmpeg/ffmpeg wrapper's module worker.
 *  - `/ffmpeg-mt/ffmpeg-core.{js,wasm,worker.js}`: the multi-threaded
 *    @ffmpeg/core-mt core and its pthread worker.
 *
 * We must pass `classWorkerURL` to `ffmpeg.load()` because the wrapper's
 * default worker construction (`new Worker(new URL("./worker.js",
 * import.meta.url), { type: "module" })`) doesn't work when @ffmpeg/ffmpeg
 * is bundled into our app: Turbopack bundles `classes.js` but doesn't emit
 * `worker.js` as a sibling asset, and even if it did, Turbopack rewrites
 * the worker's internal `await import(coreURL)` into a static module lookup
 * that throws `Cannot find module as expression is too dynamic`. Serving
 * the worker ourselves from origin side-steps both problems: the wrapper's
 * `classWorkerURL` param points at our static file, and the worker's
 * dynamic `import()` runs in the browser's native ESM loader against a
 * same-origin module URL.
 *
 * Once the worker is up, the same-origin `coreURL` / `wasmURL` let it
 * `import()` the ESM core directly — no `toBlobURL` round-trip needed
 * (saves a ~31 MB Blob allocation per page load).
 */
export function useMp4Exporter(
  options: UseMp4ExporterOptions = {},
): UseMp4ExporterResult {
  const [loadingCore, setLoadingCore] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const ffmpegRef = useRef<InstanceType<typeof FFmpeg> | null>(null);
  // Stash the latest onLoad in a ref so the exportToMp4 callback below
  // can keep a stable identity (so ShareButton's effect doesn't refire
  // on every render) while still invoking the freshest callback.
  const onLoadRef = useRef(options.onLoad);
  useEffect(() => {
    onLoadRef.current = options.onLoad;
  }, [options.onLoad]);

  const exportToMp4 = useCallback(
    async (webm: Blob): Promise<Blob> => {
      // Lazy-load ffmpeg + core on first use.
      const { fetchFile } = await import("@ffmpeg/util");

      // Lazily-loaded FFmpeg instance. We build a fresh instance per
      // export: caching across exports works on desktop Chrome but
      // leaves the wrapper's module worker in an undefined state on
      // some mobile browsers (Safari, Android in-app WebViews), where
      // the second export hangs at the next ffmpeg.load() or exec()
      // with no error. The browser's HTTP cache already serves the
      // wasm bytes from disk on subsequent loads, so the network cost
      // of going through load() again is essentially zero. The previous
      // instance (if any) is terminated so its worker is freed.
      const previous = ffmpegRef.current;
      ffmpegRef.current = null;
      if (previous) {
        try {
          previous.terminate();
        } catch {
          /* ignore terminate errors */
        }
      }

      const ffmpeg = new FFmpeg();
      setLoadingCore(true);
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
        const classWorkerURL = new URL(
          WRAPPER_WORKER_PATH,
          window.location.origin,
        ).toString();
        // Pick the core at load time. Multi-thread needs SAB (only
        // available on a cross-origin-isolated document); if it's not,
        // load the single-threaded core instead. We deliberately try
        // the single-thread fallback inside the same `try` so a
        // mid-load SAB failure transparently retries on the slower
        // but always-available core, instead of bubbling the cryptic
        // "Can't find variable: SharedArrayBuffer" to the user.
        const corePath =
          typeof window !== "undefined" &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).crossOriginIsolated === true
            ? CORE_PATH_MT
            : CORE_PATH_ST;
        const coreURL = new URL(
          `${corePath}/ffmpeg-core.js`,
          window.location.origin,
        ).toString();
        const wasmURL = new URL(
          `${corePath}/ffmpeg-core.wasm`,
          window.location.origin,
        ).toString();
        try {
          await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
        } catch (loadErr) {
          // If the mt core failed because the page isn't isolated, retry
          // once on the single-thread core. Any other load error (network,
          // bad wasm) is reported verbatim — we don't want to mask a
          // genuine problem with a slower retry.
          const needsFallback =
            corePath === CORE_PATH_MT &&
            /SharedArrayBuffer|worker/i.test(
              loadErr instanceof Error ? loadErr.message : String(loadErr),
            );
          if (!needsFallback) throw loadErr;
          const stCoreURL = new URL(
            `${CORE_PATH_ST}/ffmpeg-core.js`,
            window.location.origin,
          ).toString();
          const stWasmURL = new URL(
            `${CORE_PATH_ST}/ffmpeg-core.wasm`,
            window.location.origin,
          ).toString();
          await ffmpeg.load({
            coreURL: stCoreURL,
            wasmURL: stWasmURL,
            classWorkerURL,
          });
        }
      } catch (err) {
        setLoadingCore(false);
        throw new Error(
          `ffmpeg load failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)} (looked at ${CORE_PATH_MT}/ffmpeg-core.{js,wasm} + ffmpeg-worker.js)`,
        );
      }
      ffmpegRef.current = ffmpeg;
      setLoadingCore(false);
      // Notify the caller that the (potentially long) load is done and
      // the transcode is about to start. They can use this to swap
      // their UI label — otherwise the dialog stays on
      // "Loading the local video converter…" for the full transcode.
      onLoadRef.current?.();

      setTranscoding(true);
      setProgress(0);

      // Safari's MediaRecorder records mp4/H.264 directly (it has no webm
      // support at all — see useCanvasRecorder's pickMime). In that case we
      // only need a fast remux (add faststart for IG/web playback) instead
      // of a full re-encode, which is both slower and lossy.
      const isAlreadyMp4 = webm.type.includes("mp4");
      const inputName = isAlreadyMp4 ? "input.mp4" : "input.webm";
      const outputName = "output.mp4";
      const cleanupFiles = async () => {
        try {
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
        } catch {
          /* ignore cleanup errors */
        }
      };

      try {
        const fileBytes = await fetchFile(webm);
        await ffmpeg.writeFile(inputName, fileBytes);
      } catch (err) {
        setTranscoding(false);
        setProgress(0);
        throw new Error(
          `ffmpeg writeFile failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
      // Capture the last ffmpeg log line so we can surface the real error
      // if exec fails (ffmpeg.wasm's `exec()` resolves on a non-zero ffmpeg
      // exit code without throwing — so a silent "0-byte output" used to be
      // the only symptom of e.g. libx264 refusing an odd-dimension input).
      let lastFfmpegLine = "";
      // Progress parse — ffmpeg's `setProgress` callback (which would
      // fire `ffmpeg.on("progress", ...)`) is unreliable in 0.12.x — it
      // depends on the WASM core calling `receiveProgress` from native
      // code, which doesn't happen for our exec args. Instead we parse
      // the in-flight log lines ourselves: every progress line has
      // `time=HH:MM:SS.xx` we can divide by the known 12 s duration.
      // We only fire on the LAST log line per ~250 ms tick to avoid
      // hammering React state during a frame-rate-dense stream.
      const TOTAL_DURATION_SEC = 12;
      let lastProgressAt = 0;
      const onLog = ({ message }: { message: string }) => {
        lastFfmpegLine = message;
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(message);
        if (!m) return;
        const t =
          Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const p = Math.max(0, Math.min(1, t / TOTAL_DURATION_SEC));
        const now = performance.now();
        if (now - lastProgressAt > 250 || p >= 1) {
          lastProgressAt = now;
          setProgress(p);
        }
      };
      ffmpeg.on("log", onLog);
      // Encode settings — 1080p30, no audio.
      //   * The MediaRecorder's webm/mp4 stream declares tbr=1000 to
      //     ffmpeg (a webm convention; actual content is ~30 fps). If
      //     we leave the output framerate implicit, libx264 dup-frames
      //     its way to ~33x more output frames than the video actually
      //     contains, AND the resulting PTS timestamps confuse some
      //     players into freezing after a few seconds (they read the
      //     declared frame rate, find a mismatch, and skip to the end).
      //   * `fps=30` *filter* (not `-r 30` *option*) re-times every
      //     output frame to a clean 30 fps PTS series — the safest way
      //     to get a player-friendly 30 fps from a tbr=1000 source.
      //     It also drops the dup frames naturally because it picks
      //     frames at the output cadence rather than mirroring input.
      //   * `-an` drops audio entirely — not needed for IG Story use.
      //   * `-threads 0` lets libx264 use the browser pthread pool from
      //     @ffmpeg/core-mt. `-preset ultrafast` keeps the encode time
      //     comfortably below the old single-threaded path while the
      //     14 Mbps target retains the extra detail from the 8 Mbps
      //     MediaRecorder source.
      // We also drop `-movflags +faststart` because ffmpeg.wasm
      // implements faststart by writing the moov atom at the end and
      // then moving it; some players (notably QuickTime on macOS) read
      // the moov size from the file header before all atoms arrive and
      // then refuse to seek beyond the original moov location —
      // manifesting as a video that plays the first 3 s and then
      // freezes. mp4box.js-style players (IG, web) handle this fine.
      try {
        // -progress pipe:1 makes ffmpeg emit `frame=`/`time=` style
        // progress lines on stderr, which we parse in the `onLog`
        // handler above to drive the dialog's progress bar. Without
        // it, our progress callback never sees `time=` updates and the
        // bar stays at 0.
        await ffmpeg.exec(
          isAlreadyMp4
            ? [
                "-progress",
                "pipe:1",
                "-i",
                inputName,
                "-vf",
                "scale=1080:1920,fps=30",
                "-an",
                "-c:v",
                "libx264",
                "-threads",
                "0",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-b:v",
                "20M",
                "-maxrate",
                "26M",
                "-bufsize",
                "40M",
                "-pix_fmt",
                "yuv420p",
                outputName,
              ]
            : [
                "-progress",
                "pipe:1",
                "-i",
                inputName,
                "-vf",
                "scale=1080:1920,fps=30",
                "-an",
                "-c:v",
                "libx264",
                "-threads",
                "0",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-b:v",
                "20M",
                "-maxrate",
                "26M",
                "-bufsize",
                "40M",
                "-pix_fmt",
                "yuv420p",
                outputName,
              ],
        );
      } catch (err) {
        await cleanupFiles();
        setTranscoding(false);
        setProgress(0);
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
        await cleanupFiles();
        setTranscoding(false);
        setProgress(0);
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
        await cleanupFiles();
        setTranscoding(false);
        setProgress(0);
        throw new Error(
          `ffmpeg produced an empty output (last ffmpeg log: ${lastFfmpegLine || "none"})`,
        );
      }
      // Copy into a fresh ArrayBuffer-backed Uint8Array so Blob accepts it
      // (ffmpeg returns a Uint8Array whose .buffer may be a SharedArrayBuffer).
      const mp4Bytes = new Uint8Array(data.byteLength);
      mp4Bytes.set(data);
      const mp4 = new Blob([mp4Bytes], { type: "video/mp4" });
      await cleanupFiles();

      setTranscoding(false);
      setProgress(0);

      return mp4;
    },
    [],
  );

  return { loadingCore, transcoding, progress, exportToMp4 };
}
