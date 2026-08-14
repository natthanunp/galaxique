"use client";

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

import { Button } from "@/components/ui/button";
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

interface ShareButtonProps {
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
  /** Called with true when export starts (boosts R3F DPR) and false when it ends. */
  onExportModeChange?: (exporting: boolean) => void;
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

/** Orchestrates the IG Story export: composite album art + song overlay onto
 *  the canvas → record → transcode webm→mp4 → share or download. */
export function ShareButton({
  getCanvas,
  getStarfield,
  disabled = false,
  language,
  reading,
  vibe,
  onExportModeChange,
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

      const starfieldCanvas = getStarfield?.() ?? null;
      // Always render the overlay bar (even without a track — show a
      // generic "Your universe" label rather than omitting it). The
      // R3F canvas is transparent, so without compositing the starfield
      // and dark fill, the export looks like a flat silhouette over
      // white. drawOnce() handles all of that internally.
      const composed = await overlay.drawOnce({
        source: sourceCanvas,
        background: starfieldCanvas,
        info: {
          albumArtUrl: track?.albumArtUrl ?? null,
          trackName: track?.name ?? (language === "th" ? "จักรวาลของคุณ" : "Your universe"),
          artist: track?.artist ?? "Galaxique",
          reading,
          vibe,
          language,
        },
      });
      if (cancelledRef.current) return;

      // canvas.toBlob is async and respects preserveDrawingBuffer: true
      // (which UniverseCanvas already sets). We do NOT include the
      // Spotify audio in the PNG — the song is just *referenced* in the
      // overlay text + album art.
      const blob: Blob = await new Promise((resolve, reject) => {
        composed.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
          "image/png",
        );
      });
      if (cancelledRef.current) return;

      finishExport(blob, "image", "galaxique-universe.png");

    } catch (err) {
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
    onExportModeChange?.(true);

    try {
      await waitForFrames(2);
      const sourceCanvas = getCanvas();
      // Defensive: the trigger button is disabled until the canvas mounts,
      // so this should be unreachable in practice. If the canvas unmounts
      // between opening the dialog and clicking Start, fail with a clear
      // message rather than the downstream cryptic MediaRecorder error.
      if (!sourceCanvas) throw new Error("Universe canvas isn't ready yet.");

      // Composite album art + song name/artist onto an offscreen canvas so
      // the exported video visually shows the Spotify track, not just plays
      // its audio. Pre-load the Thai font so the overlay doesn't render the
      // first frames with a fallback typeface.
      await overlay.loadFonts();
      if (cancelledRef.current) return;

      const recordTarget = track
        ? overlay.start({
            source: sourceCanvas,
            fps: 30,
            info: {
              albumArtUrl: track.albumArtUrl,
              trackName: track.name,
              artist: track.artist,
              reading,
              vibe,
              language,
            },
          })
        : sourceCanvas;

      if (cancelledRef.current) return;

      // The final MP4 deliberately has no audio. Avoid fetching, decoding,
      // mixing, and MediaRecorder-encoding a preview track only for ffmpeg
      // to discard it later with `-an`.
      const recorded = await recorder.record(recordTarget);
      overlay.stop();
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
          className="gap-2"
          disabled={disabled}
          title={
            disabled
              ? language === "th"
                ? "จักรวาลกำลังโหลด — ลองใหม่อีกครั้งในอีกสักครู่"
                : "Universe is still loading — try again in a moment."
              : undefined
          }
        >
          <ShareIcon className="size-4" />
          {language === "th" ? "แชร์ไป Story" : "Share to Story"}
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
