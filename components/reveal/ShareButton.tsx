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
import { createAudioStreamFromUrl } from "@/lib/audioCapture";
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
  /** Temporarily raises the live renderer DPR while a capture is prepared. */
  onCaptureQualityChange?: (capturing: boolean) => void;
  language: Language;
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
 *  the canvas → record with the Spotify preview audio muxed in → transcode
 *  webm→mp4 (or fast-remux if Safari already recorded mp4) → download. */
export function ShareButton({
  getCanvas,
  getStarfield,
  disabled = false,
  onCaptureQualityChange,
  language,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadKind, setDownloadKind] = useState<"image" | "video" | null>(null);
  const [downloadFilename, setDownloadFilename] = useState("galaxique-universe.png");
  const cancelledRef = useRef(false);
  const audioRef = useRef<Awaited<ReturnType<typeof createAudioStreamFromUrl>>>(null);

  const recorder = useCanvasRecorder({ durationMs: 12000, fps: 30 });
  const exporter = useMp4Exporter();
  const overlay = useOverlayCanvas();
  const track = useMediaStore((s) => s.track);
  const spotifyUrl = useMediaStore((s) => s.spotifyUrl);

  /** Static screenshot path: composite the universe + album art + song
   *  info onto an offscreen canvas (one frame, no recording), then
   *  download the result as a PNG. No MediaRecorder, no ffmpeg, no 12s
   *  wait — finishes in <1s. Works in every browser. */
  const handleSavePhoto = async () => {
    cancelledRef.current = false;
    setErrorMsg("");
    setDownloadUrl(null);
    setDownloadKind(null);
    setDownloadFilename("galaxique-universe.png");
    setPhase("exporting-photo");
    onCaptureQualityChange?.(true);

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

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadKind("image");
      setPhase("done");

    } catch (err) {
      if (cancelledRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
    } finally {
      onCaptureQualityChange?.(false);
    }
  };

  const handleShare = async () => {
    cancelledRef.current = false;
    setErrorMsg("");
    setDownloadUrl(null);
    setDownloadKind(null);
    setPhase("recording");
    onCaptureQualityChange?.(true);

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
      // its audio.
      const recordTarget = track
        ? overlay.start({
            source: sourceCanvas,
            info: {
              albumArtUrl: track.albumArtUrl,
              trackName: track.name,
              artist: track.artist,
            },
          })
        : sourceCanvas;

      // Decode the actual Spotify/iTunes preview audio (if any) into a
      // MediaStream so it can be muxed into the recording. We don't rely on
      // HTMLMediaElement.captureStream() since Safari never implemented it.
      audioRef.current = spotifyUrl
        ? await createAudioStreamFromUrl(spotifyUrl)
        : null;
      if (cancelledRef.current) return;

      const webm = await recorder.record(recordTarget, {
        audioStream: audioRef.current?.stream ?? null,
        onStart: () => audioRef.current?.start(),
      });
      overlay.stop();
      audioRef.current?.stop();
      audioRef.current = null;
      if (cancelledRef.current) return;

      setPhase("loading-core");
      let video = webm;
      let filename = "galaxique-universe.webm";
      try {
        video = await exporter.exportToMp4(webm);
        filename = "galaxique-universe.mp4";
      } catch (transcodeError) {
        // Keep the browser-native recording usable when the optional ffmpeg
        // core is blocked or unavailable.
        console.warn("MP4 conversion failed; keeping the original recording.", transcodeError);
      }
      if (cancelledRef.current) return;

      const url = URL.createObjectURL(video);
      setDownloadUrl(url);
      setDownloadKind("video");
      setDownloadFilename(filename);
      setPhase("done");
    } catch (err) {
      overlay.stop();
      audioRef.current?.stop();
      audioRef.current = null;
      if (cancelledRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase("error");
    } finally {
      onCaptureQualityChange?.(false);
    }
  };

  const handleReset = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadKind(null);
    setDownloadFilename("galaxique-universe.png");
    setErrorMsg("");
    setPhase("idle");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing mid-process cancels everything.
      cancelledRef.current = true;
      recorder.cancel();
      overlay.stop();
      audioRef.current?.stop();
      audioRef.current = null;
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
            "กำลังโหลดตัวแปลงวิดีโอ (~31MB ครั้งเดียว)…",
          transcoding: "กำลังแปลงเป็น MP4 สำหรับ Instagram…",
          done: "จักรวาลของคุณพร้อมแชร์แล้ว!",
          error: "เกิดข้อผิดพลาดขึ้น",
        }
      : {
          idle: "Ready to capture your universe.",
          "exporting-photo": "Saving your universe photo…",
          recording: "Recording your spinning universe…",
          "loading-core":
            "Loading the video converter (~31MB, one-time)…",
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
                <Button asChild className="self-end gap-2">
                  <a href={downloadUrl} download={downloadFilename}>
                    <DownloadIcon className="size-4" />
                    {language === "th" ? "บันทึกไฟล์" : "Save file"}
                  </a>
                </Button>
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
                  audioRef.current?.stop();
                  audioRef.current = null;
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
                  disabled
                  title={
                    language === "th"
                      ? "การส่งออกวิดีโอยังไม่พร้อมใช้งาน"
                      : "Video export is temporarily unavailable."
                  }
                >
                  <VideoIcon className="size-4" />
                  {language === "th" ? "วิดีโอ (เร็ว ๆ นี้)" : "Video (coming soon)"}
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
