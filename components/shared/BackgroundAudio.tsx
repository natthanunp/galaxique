"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { useMediaStore } from "@/store/mediaStore";
import {
  initAmbient,
  playSpotifyPreview,
  resumeAmbient,
  setAudioMuted,
  resumeAudioFromGesture,
} from "@/lib/audioEngine";
import { cn } from "@/lib/utils";

interface BackgroundAudioProps {
  /** Path to the audio file under /public. */
  src?: string;
  /** Initial volume (0–1). Default 0.35 — ambient, not overpowering. */
  defaultVolume?: number;
  className?: string;
}

/**
 * Site-wide background audio backed by the Web Audio API.
 *
 * Playback is scheduled on the audio thread, so scrolling, quiz answers,
 * React renders, and API responses cannot crackle the output. Ambient and
 * Spotify preview are decoded once into AudioBuffers and crossfaded.
 */
export function BackgroundAudio({
  src = "/audio/ambient-space.mp3",
  defaultVolume = 0.35,
  className,
}: BackgroundAudioProps) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const mediaMode = useMediaStore((s) => s.mode);
  const spotifyUrl = useMediaStore((s) => s.spotifyUrl);
  const didInit = useRef(false);

  // Decode and start ambient loop on mount. Browsers allow silent Web Audio
  // contexts without a gesture, but the master gain stays at 0 until the user
  // interacts (or toggles the button).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    initAmbient(src, defaultVolume)
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [src, defaultVolume]);

  // Crossfade between ambient and Spotify preview when mediaStore signals it.
  useEffect(() => {
    if (!ready) return;
    if (mediaMode === "spotify" && spotifyUrl) {
      playSpotifyPreview(spotifyUrl).catch(() => {
        // Fall back to ambient if preview decoding fails.
        resumeAmbient();
      });
    } else {
      resumeAmbient();
    }
  }, [mediaMode, spotifyUrl, ready]);

  // First user interaction unlocks the audio context and unmutes.
  // We call resume synchronously inside the event handler because iOS
  // Safari requires the resume to be directly tied to the gesture.
  useEffect(() => {
    const arm = (event: Event) => {
      resumeAudioFromGesture();
      setAudioMuted(false);
      setEnabled(true);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
      // For touch events, also prevent the delayed mouse emulation from
      // firing a second unlock attempt.
      if (event.type === "touchstart") {
        window.removeEventListener("click", arm);
      }
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    window.addEventListener("touchstart", arm, { once: true });
    window.addEventListener("click", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
      window.removeEventListener("click", arm);
    };
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setAudioMuted(!next);
    if (next) resumeAudioFromGesture();
  };

  return (
    <>
      {mediaMode === "ambient" && (
        <button
          type="button"
          onClick={toggle}
          aria-label={enabled ? "Mute ambient audio" : "Play ambient audio"}
          title={enabled ? "Mute ambient audio" : "Play ambient audio"}
          className={cn(
            "fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground shadow-md backdrop-blur-md transition-all hover:scale-105 hover:bg-card",
            className,
          )}
        >
          {enabled ? (
            <Volume2Icon className="size-4" />
          ) : (
            <VolumeXIcon className="size-4 text-muted-foreground" />
          )}
        </button>
      )}
    </>
  );
}
