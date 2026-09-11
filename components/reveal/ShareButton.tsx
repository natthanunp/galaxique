"use client";

import type { ProfileMetadata } from "@/lib/profile";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShareIcon,
  VideoIcon,
  DownloadIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "lucide-react";

import { captureUniverseFrame } from "@/three/hooks/captureUniverseFrame";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCanvasRecorder } from "@/three/hooks/useCanvasRecorder";
import { useMp4Exporter } from "@/three/hooks/useMp4Exporter";
import { useOverlayCanvas } from "@/three/hooks/useOverlayCanvas";
import { useMediaStore } from "@/store/mediaStore";
import type { Language } from "@/types/universe";

interface ShareButtonProps extends ProfileMetadata {
  /** Accessor for the live R3F canvas element to record. */
  getCanvas: () => HTMLCanvasElement | null;
  /** Accessor for the 2D starfield DOM canvas, used as the background of
   *  the static screenshot export. Optional — if omitted, the screenshot
   *  falls back to a plain dark background. */
  getStarfield?: () => HTMLCanvasElement | null;
  /** While false, the trigger is disabled (canvas still mounting). */
  disabled?: boolean;
  language: Language;
  reading: string;
  /** The reveal vibe — used to render the "Your vibe · …" label on the
   *  exported story card. */
  vibe: string;
  /** Called while export is active. Video exports supply the static story card
   * data that UniverseCanvas renders into the direct WebGL capture. */
  onExportModeChange?: (
    exporting: boolean,
    overlay?: {
      albumArtUrl: string | null;
      trackName: string;
      artist: string;
      reading: string;
      vibe: string;
      profile_version?: 2;
      theme?: ProfileMetadata["theme"];
      language: Language;
    },
  ) => void;
  /** Button size — defaults to "default" (h-10) for the standalone
   *  full-bleed layout. The reveal page header passes "sm" so the
   *  share trigger matches the height of the surrounding icon buttons
   *  in the top bar. */
  size?: "default" | "sm";
  /** Extra classes for the trigger button. Useful for matching the
   *  surrounding button chrome (rounded-full, padding, etc.). */
  className?: string;
  /** When true, hide the "Share to Story" text label and render the
   *  trigger as an icon-only square button. The aria-label still
   *  describes the action for screen readers. The reveal page header
   *  passes this on mobile so the share button doesn't crowd the
   *  chat/retake siblings out of the screen. */
  hideLabel?: boolean;
}

type Phase =
  | "idle"
  | "exporting-photo"
  | "recording"
  | "loading-core"
  | "transcoding"
  | "done"
  | "error";

function waitForFrames(count: number): Promise<void> {
  if (count <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(waitForFrames(count - 1)));
  });
}

function waitForPortraitCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const targetAspect = 9 / 16;
  const timeoutAt = performance.now() + 3_000;

  return new Promise((resolve, reject) => {
    const check = () => {
      const aspect = canvas.width / canvas.height;
      // Export mode sets R3F's dpr to 2. Wait for the corresponding drawing
      // buffer allocation rather than accepting the first CSS-resolution
      // 9:16 resize, which produces a visibly soft video.
      const expectedWidth = canvas.clientWidth * 1.9;
      if (
        canvas.width >= expectedWidth
        && Math.abs(aspect - targetAspect) < 0.02
      ) {
        console.log("[export] portrait canvas ready", {
          width: canvas.width,
          height: canvas.height,
          aspect: Number(aspect.toFixed(3)),
          expectedWidth: Math.round(expectedWidth),
        });
        resolve();
        return;
      }
      if (performance.now() >= timeoutAt) {
        reject(new Error("The export canvas did not resize to a portrait story frame."));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

interface CanvasVideoFrameSource {
  video: HTMLVideoElement;
  stop: () => void;
}

/**
 * Produces a single drawable video frame from a WebGL canvas. Unlike
 * `drawImage(webglCanvas)`, this remains valid with preserveDrawingBuffer
 * disabled. It is only used for the one-shot PNG path, never per video frame.
 */
async function createCanvasVideoFrameSource(
  canvas: HTMLCanvasElement,
): Promise<CanvasVideoFrameSource> {
  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  const stop = () => {
    video.pause();
    video.srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
  };

  try {
    await video.play();
    await waitForCanvasVideoFrame(video);
    return { video, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

function waitForCanvasVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.videoWidth > 0
    && video.videoHeight > 0
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutAt = performance.now() + 3_000;
    const finish = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
      } else if (performance.now() >= timeoutAt) {
        reject(new Error("Timed out waiting for the universe photo frame."));
      } else {
        requestAnimationFrame(finish);
      }
    };

    requestAnimationFrame(finish);
  });
}

/** Orchestrates the IG Story export: composite album art + song overlay onto
 *  the canvas → record → transcode webm→mp4 → share or download. */
export function ShareButton({
  getCanvas,
  getStarfield,
  disabled = false,
  language,
  reading,
  vibe,
  profile_version,
  theme,
  onExportModeChange,
  size = "default",
  className,
  hideLabel = false,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadKind, setDownloadKind] = useState<"image" | "video" | null>(null);
  const [downloadFilename, setDownloadFilename] = useState("galaxique-universe.png");
  const [exportFile, setExportFile] = useState<File | null>(null);
  const cancelledRef = useRef(false);
  // A pending share intent. Mobile Safari/WebViews will reject
  // navigator.share() unless the call happens inside (or very shortly
  // after) the user gesture that started the export. A 12-second
  // recording + ffmpeg encode loses that activation window, so the
  // call from finishExport arrives "not user-activated" and silently
  // resolves to false. We register the intent at click time: the
  // gesture is fresh, and finishExport dispatches it as soon as the
  // file is ready. Cleared on cancel/reset so a stale intent doesn't
  // open the share sheet for the wrong export.
  const pendingShareRef = useRef<boolean>(false);

  // Capture at the same stable frame rate we encode. Asking ffmpeg to turn
  // a 30fps canvas stream into 60fps only duplicates frames, while asking
  // the live renderer to sustain 60fps at capture DPR can cause uneven
  // frame delivery. A true 30fps source and 30fps output looks smoother.
  const recorder = useCanvasRecorder({ durationMs: 12000, fps: 30 });
  // onLoad fires the moment the ffmpeg core is ready and the (much
  // slower) transcode is about to start — we use it to swap the dialog
  // from "Loading the local video converter…" to a transcode-specific
  // label so the user sees real progress for the rest of the export.
  const exporter = useMp4Exporter({
    onLoad: () => {
      if (!cancelledRef.current) setPhase("transcoding");
    },
  });
  const overlay = useOverlayCanvas();
  const track = useMediaStore((s) => s.track);
  const setMediaSuspended = useMediaStore((s) => s.setSuspended);

  const shareFile = async (file: File) => {
    if (!navigator.share || !navigator.canShare) return false;

    try {
      if (!navigator.canShare({ files: [file] })) return false;
      await navigator.share({
        files: [file],
        title: "Galaxique universe",
      });
      return true;
    } catch (err) {
      // A dismissed sheet and browsers that require a fresh user gesture
      // both arrive here. The visible Share file button remains available.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.warn("[share] Native share did not open:", err);
      }
      return false;
    }
  };

  const finishExport = (
    blob: Blob,
    kind: "image" | "video",
    filename: string,
  ) => {
    const file = new File([blob], filename, { type: blob.type });
    const url = URL.createObjectURL(blob);
    setExportFile(file);
    setDownloadUrl(url);
    setDownloadKind(kind);
    setDownloadFilename(filename);
    setPhase("done");
    if (pendingShareRef.current) {
      // Consume the user-gesture intent registered in the click
      // handler. We can't await here (we're not in an async path), so
      // we kick off the share and let any rejection be silent — the
      // visible Share file button stays as a retry path.
      pendingShareRef.current = false;
      void shareFile(file);
    }
  };

  /** Static screenshot path: composite the universe + album art + song
   *  info onto an offscreen canvas (one frame, no recording), then
   *  download the result as a PNG. No MediaRecorder, no ffmpeg, no 12s
   *  wait — finishes in <1s. Works in every browser. */
  const handleSavePhoto = async () => {
    let frameSource: CanvasVideoFrameSource | null = null;
    let snapshot: ImageBitmap | null = null;
    cancelledRef.current = false;
    pendingShareRef.current = true;
    setErrorMsg("");
    setDownloadUrl(null);
    setDownloadKind(null);
    setDownloadFilename("galaxique-universe.png");
    setPhase("exporting-photo");
    onExportModeChange?.(true);

    try {
      const sourceCanvas = getCanvas();
      if (!sourceCanvas) throw new Error("Universe canvas isn't ready yet.");
      if (cancelledRef.current) return;

      // Wait two rAF ticks so R3F renders a fresh frame right before
      // capture. The first rAF is when the draw call actually lands; the
      // second is a safety net. Without this, the captured frame is
      // sometimes the stale "first frame after canvas resize" which
      // can be a flat edge-on view of the galaxy (caught edge-on by
      // auto-rotate at the wrong moment) or even blank.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelledRef.current) return;
      await waitForPortraitCanvas(sourceCanvas);
      if (cancelledRef.current) return;

      if (typeof createImageBitmap === "function") {
        try { snapshot = await captureUniverseFrame(sourceCanvas); }
        catch { /* Fall back if this browser cannot snapshot its WebGL buffer. */ }
      }
      if (!snapshot && !cancelledRef.current) {
        frameSource = await createCanvasVideoFrameSource(sourceCanvas);
      }
      if (cancelledRef.current) { snapshot?.close(); frameSource?.stop(); return; }

      const starfieldCanvas = getStarfield?.() ?? null;
      // Always render the overlay bar (even without a track — show a
      // generic "Your universe" label rather than omitting it). The
      // R3F canvas is transparent, so without compositing the starfield
      // and dark fill, the export looks like a flat silhouette over
      // white. drawOnce() handles all of that internally.
      const composed = await overlay.drawOnce({
        source: snapshot ?? frameSource!.video,
        background: starfieldCanvas,
        info: {
          albumArtUrl: track?.albumArtUrl ?? null,
          trackName: track?.name ?? (language === "th" ? "จักรวาลของคุณ" : "Your universe"),
          artist: track?.artist ?? "Galaxique",
          reading,
          vibe,
          profile_version,
          theme,
          language,
        },
      });
      if (cancelledRef.current) { snapshot?.close(); frameSource?.stop(); return; }

      // canvas.toBlob is async. We do NOT include the
      // Spotify audio in the PNG — the song is just *referenced* in the
      // overlay text + album art.
      const blob: Blob = await new Promise((resolve, reject) => {
        composed.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
          "image/png",
        );
      });
      snapshot?.close();
      snapshot = null;
      frameSource?.stop();
      frameSource = null;
      if (cancelledRef.current) return;

      finishExport(blob, "image", "galaxique-universe.png");

    } catch (err) {
      snapshot?.close();
      frameSource?.stop();
      if (cancelledRef.current) return;
      pendingShareRef.current = false;
      onExportModeChange?.(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
    }
  };

  const handleShare = async () => {
    cancelledRef.current = false;
    pendingShareRef.current = true;
    setErrorMsg("");
    setDownloadUrl(null);
    setDownloadKind(null);
    setPhase("recording");
    onExportModeChange?.(true, {
      albumArtUrl: track?.albumArtUrl ?? null,
      trackName: track?.name ?? (language === "th" ? "จักรวาลของคุณ" : "Your universe"),
      artist: track?.artist ?? "Galaxique",
      reading,
      vibe,
      profile_version,
      theme,
      language,
    });

    try {
      await waitForFrames(2);
      const sourceCanvas = getCanvas();
      // Defensive: the trigger button is disabled until the canvas mounts,
      // so this should be unreachable in practice. If the canvas unmounts
      // between opening the dialog and clicking Start, fail with a clear
      // message rather than the downstream cryptic MediaRecorder error.
      if (!sourceCanvas) throw new Error("Universe canvas isn't ready yet.");
      await waitForPortraitCanvas(sourceCanvas);
      if (cancelledRef.current) return;

      // Recording the R3F canvas directly keeps capture on the GPU path.
      // The 2D overlay compositor is intentionally photo-only: on mobile,
      // putting it in the video pipeline adds a fixed ~50ms sync per frame
      // and hard-caps the final recording at ~21fps regardless of resolution.
      console.log("[export] direct WebGL capture", {
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        fps: 30,
      });

      // The final MP4 deliberately has no audio. Avoid fetching, decoding,
      // mixing, and MediaRecorder-encoding a preview track only for ffmpeg
      // to discard it later with `-an`.
      const recorded = await recorder.record(sourceCanvas);
      if (cancelledRef.current) return;

      // Surface what the recorder actually produced. Chrome/Firefox give us
      // webm; Safari gives us MP4/H.264 directly. Both go through ffmpeg so
      // the final file is always an H.264 MP4 with no audio, compatible
      // with Instagram and iOS Photos. We do NOT keep the
      // raw webm as a fallback — it would download as `galaxique-universe.webm`
      // and fail to open in iOS Photos / Instagram uploads, which is
      // exactly the previous "0 bytes / can't open" symptom.
      if (recorded.size === 0) {
        throw new Error("Recording produced an empty file. Try again, and check the browser console for MediaRecorder errors.");
      }

      setPhase("loading-core");
      const video = await exporter.exportToMp4(recorded);
      if (video.size === 0) {
        throw new Error("The MP4 converter produced an empty file. This usually means ffmpeg's core failed to load — check your network or browser console.");
      }
      if (cancelledRef.current) return;

      finishExport(video, "video", "galaxique-universe.mp4");
    } catch (err) {
      overlay.stop();
      if (cancelledRef.current) return;
      pendingShareRef.current = false;
      onExportModeChange?.(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
    }
  };

  const handleReset = () => {
    pendingShareRef.current = false;
    onExportModeChange?.(false);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadKind(null);
    setExportFile(null);
    setDownloadFilename("galaxique-universe.png");
    setErrorMsg("");
    setPhase("idle");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setMediaSuspended(next);
    if (!next) {
      // Closing mid-process cancels everything.
      cancelledRef.current = true;
      recorder.cancel();
      overlay.stop();
      handleReset();
    }
  };

  const pct =
    phase === "recording"
      ? recorder.progress * 100
      : phase === "transcoding"
        ? exporter.progress * 100
        : phase === "loading-core"
          ? 100
          : phase === "exporting-photo"
            ? 50
            : phase === "done"
              ? 100
              : 0;

  const statusLabel: Record<Phase, string> =
    language === "th"
      ? {
          idle: "พร้อมบันทึกจักรวาลของคุณ",
          "exporting-photo": "กำลังบันทึกภาพจักรวาลของคุณ…",
          recording: "กำลังอัดวิดีโอจักรวาลที่หมุนอยู่…",
          "loading-core":
            "กำลังเตรียมตัวแปลงวิดีโอ MP4…",
          transcoding: "กำลังแปลงเป็น MP4 สำหรับ Instagram…",
          done: "จักรวาลของคุณพร้อมแชร์แล้ว!",
          error: "เกิดข้อผิดพลาดขึ้น",
        }
      : {
          idle: "Ready to capture your universe.",
          "exporting-photo": "Saving your universe photo…",
          recording: "Recording your spinning universe…",
          "loading-core":
            "Loading the local video converter…",
          transcoding: "Converting to MP4 for Instagram…",
          done: "Your universe is ready to share!",
          error: "Something went wrong.",
        };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size={size}
          className={cn(
            hideLabel ? "size-10 gap-0 px-0" : "gap-2",
            className,
          )}
          disabled={disabled}
          aria-label={
            language === "th" ? "แชร์ไป Story" : "Share to Story"
          }
          title={
            disabled
              ? language === "th"
                ? "จักรวาลกำลังโหลด — ลองใหม่อีกครั้งในอีกสักครู่"
                : "Universe is still loading — try again in a moment."
              : language === "th"
                ? "แชร์ไป Story"
                : "Share to Story"
          }
        >
          <ShareIcon className="size-4" />
          {!hideLabel && (
            <span>{language === "th" ? "แชร์ไป Story" : "Share to Story"}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShareIcon className="size-5 text-accent" />
            {language === "th" ? "ส่งออกจักรวาลของคุณ" : "Export your universe"}
          </DialogTitle>
          <DialogDescription>
            {language === "th"
              ? "บันทึกภาพจักรวาลของคุณ"
              : "Save a photo of your universe."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center gap-2 text-sm">
                {phase === "recording" && (
                  <Loader2Icon className="size-4 animate-spin text-primary" />
                )}
                {phase === "loading-core" && (
                  <Loader2Icon className="size-4 animate-spin text-primary" />
                )}
                {phase === "transcoding" && (
                  <Loader2Icon className="size-4 animate-spin text-primary" />
                )}
                {phase === "done" && (
                  <CheckCircle2Icon className="size-4 text-green-400" />
                )}
                {phase === "error" && (
                  <AlertCircleIcon className="size-4 text-destructive" />
                )}
                {phase === "idle" && (
                  <VideoIcon className="size-4 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">
                  {statusLabel[phase]}
                </span>
              </div>

              {phase !== "idle" && phase !== "error" && (
                <Progress value={pct} />
              )}

              {phase === "error" && (
                <p className="text-xs text-muted-foreground">{errorMsg}</p>
              )}

              {phase === "done" && downloadUrl && downloadKind === "image" && (
                // Generated PNGs use a transient blob URL that next/image cannot optimize.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={downloadUrl}
                  alt="Your generated universe"
                  className="w-full rounded-lg border border-border/70"
                />
              )}
              {phase === "done" && downloadUrl && downloadKind === "video" && (
                <video
                  src={downloadUrl}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full rounded-lg border border-border/70"
                />
              )}
              {phase === "done" && downloadUrl && (
                <div className="flex flex-wrap justify-end gap-2">
                  {exportFile && (
                    <Button
                      variant="outline"
                      onClick={() => void shareFile(exportFile)}
                      className="gap-2"
                    >
                      <ShareIcon className="size-4" />
                      {language === "th" ? "แชร์ไฟล์" : "Share file"}
                    </Button>
                  )}
                  <Button asChild className="gap-2">
                    <a href={downloadUrl} download={downloadFilename}>
                      <DownloadIcon className="size-4" />
                      {language === "th" ? "บันทึกไฟล์" : "Save file"}
                    </a>
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={() => {
                  cancelledRef.current = true;
                  recorder.cancel();
                  overlay.stop();
                  handleReset();
                }}
              >
                {language === "th" ? "ปิด" : "Close"}
              </Button>
            </DialogClose>
            {phase === "idle" && (
              <>
                <Button
                  variant="outline"
                  onClick={handleSavePhoto}
                  className="gap-2"
                >
                  <ShareIcon className="size-4" />
                  {language === "th" ? "บันทึกภาพ" : "Save photo"}
                </Button>
                <Button
                  onClick={handleShare}
                  className="gap-2"
                >
                  <VideoIcon className="size-4" />
                  {language === "th" ? "บันทึกวิดีโอ MP4" : "Save MP4 video"}
                </Button>
              </>
            )}
            {phase === "exporting-photo" && (
              <Button
                variant="outline"
                onClick={() => {
                  cancelledRef.current = true;
                  handleReset();
                }}
              >
                {language === "th" ? "ยกเลิก" : "Cancel"}
              </Button>
            )}
            {(phase === "recording" ||
              phase === "loading-core" ||
              phase === "transcoding") && (
              <Button
                variant="outline"
                onClick={() => {
                  cancelledRef.current = true;
                  recorder.cancel();
                  handleReset();
                }}
              >
                {language === "th" ? "ยกเลิก" : "Cancel"}
              </Button>
            )}
            {phase === "done" && (
              <>
                <Button variant="outline" onClick={handleReset}>
                  {language === "th" ? "เสร็จสิ้น" : "Done"}
                </Button>
              </>
            )}
            {phase === "error" && (
              <Button variant="outline" onClick={handleReset}>
                {language === "th" ? "ลองใหม่อีกครั้ง" : "Try again"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
