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
      // NOTE: we intentionally do NOT dynamically import @ffmpeg/util's
      // fetchFile here. Under Turbopack (next dev / next build) that
      // dynamic import() produced a chunk whose module execution
      // intermittently failed with a `runModuleExecutionHooks` error —
      // and fetchFile's only job for us is turning a Blob into a
      // Uint8Array, which `Blob.arrayBuffer()` does natively. Inlining it
      // (below) removes the flaky chunk AND lets us sniff the real
      // container format from the bytes (see the writeFile step).

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
      // only need a fast `-c copy` remux into a standard progressive mp4
      // (IG/web-playable) instead of a full re-encode, which is both slower
      // and lossy. No +faststart: see the note below about ffmpeg.wasm's
      // faststart breaking QuickTime playback.
      //
      // Read the recorded blob into memory once (Blob.arrayBuffer(), not
      // @ffmpeg/util's fetchFile — see the NOTE above about the flaky
      // Turbopack dynamic-import chunk). We sniff the real container from
      // the bytes instead of trusting blob.type: iOS Safari's MediaRecorder
      // records H.264 mp4 reliably, but the blob.type it reports can omit
      // "mp4" (or be empty) on some iOS versions, which would otherwise
      // route a perfectly-good mp4 into the slow libx264 transcode branch
      // and look like a "stuck at Converting to MP4" hang. Magic bytes are
      // bulletproof: an MP4 family file has a `ftyp` box at offset 4;
      // WebM/Matroska starts with the EBML magic 0x1A45DFA3.
      let fileBytes: Uint8Array;
      try {
        fileBytes = new Uint8Array(await webm.arrayBuffer());
      } catch (err) {
        setTranscoding(false);
        setProgress(0);
        throw new Error(
          `failed to read recorded video into memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const isMp4ByMagic =
        fileBytes.length >= 8 &&
        fileBytes[4] === 0x66 && // f
        fileBytes[5] === 0x74 && // t
        fileBytes[6] === 0x79 && // y
        fileBytes[7] === 0x70; //   p
      const isWebmByMagic =
        fileBytes.length >= 4 &&
        fileBytes[0] === 0x1a &&
        fileBytes[1] === 0x45 &&
        fileBytes[2] === 0xdf &&
        fileBytes[3] === 0xa3;
      // Trust the magic bytes; only fall back to blob.type when the sniff
      // is inconclusive (an unusual container we don't sniff for).
      const isAlreadyMp4 =
        isMp4ByMagic || (!isWebmByMagic && webm.type.includes("mp4"));
      // Forward what we detected + the isolation/core choice to the
      // dev-server log so the iOS Safari path can be confirmed from the
      // log instead of guessed at.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isolated = typeof window !== "undefined" && (window as any).crossOriginIsolated === true;
      console.log("[export] format detect", {
        blobType: webm.type,
        blobSize: webm.size,
        isMp4ByMagic,
        isWebmByMagic,
        isAlreadyMp4,
        crossOriginIsolated: isolated,
        coreUsed: isolated ? CORE_PATH_MT : CORE_PATH_ST,
      });
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
      //     @ffmpeg/core-mt.
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
        //
        // Two genuinely different paths:
        //   * Safari's MediaRecorder already produced an H.264 mp4
        //     (no webm support — see useCanvasRecorder's pickMime).
        //     Re-encoding it is pure waste: a full libx264 pass at
        //     `-preset medium` on the SINGLE-THREADED wasm core (iOS
        //     Safari has no cross-origin isolation → no SharedArrayBuffer
        //     → single-thread core) takes minutes and looks like a
        //     "stuck at converting to MP4" hang. We do a fast
        //     `-c copy` remux instead — near-instant, lossless.
        //   * Chrome/Firefox give us webm, which DOES need a real
        //     libx264 transcode. We use `veryfast` + `crf 23` (not
        //     `medium` + `crf 18` + 20Mbps) so the 12s 1080p30 output
        //     lands around ~5-8MB — big enough to look crisp on a phone
        //     screen, small enough that Chrome Android's download/share
        //     doesn't reject it with "A network error occurred".
        //
        // `exec(args, timeoutMs)` returns ffmpeg's ret code (0 = ok,
        // 1 = timeout/error). We capture it so a non-zero exit (which
        // ffmpeg.wasm does NOT throw on) surfaces as a clear error
        // instead of a silent 0-byte output. The timeout is a generous
        // ceiling — the remux is seconds, the re-encode is <1min on
        // modern hardware — but it prevents a hung worker (mobile
        // WebView) from leaving the promise pending forever.
        const ret = isAlreadyMp4
          ? await ffmpeg.exec(
              [
                "-progress",
                "pipe:1",
                "-i",
                inputName,
                "-c",
                "copy",
                outputName,
              ],
              30_000,
            )
          : await ffmpeg.exec(
              [
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
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                outputName,
              ],
              300_000,
            );
        if (ret !== 0) {
          await cleanupFiles();
          setTranscoding(false);
          setProgress(0);
          throw new Error(
            `ffmpeg exited with code ${ret} (last ffmpeg log: ${lastFfmpegLine || "none"})`,
          );
        }
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
