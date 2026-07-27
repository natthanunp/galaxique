"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { useMediaStore } from "@/store/mediaStore";
import { cn } from "@/lib/utils";

interface BackgroundAudioProps {
  /** Path to the audio file under /public. */
  src?: string;
  /** Initial volume (0–1). Default 0.35 — ambient, not overpowering. */
  defaultVolume?: number;
  className?: string;
}

/**
 * Site-wide ambient background audio.
 *
 * Browsers refuse to autoplay with sound on, so:
 *  1. Mount the <audio> element with `muted` and try `play()` immediately —
 *     muted autoplay is always allowed.
 *  2. The FIRST user interaction (click / keydown / touch) unmutes the audio
 *     and we attempt playback. Audio is enabled by default, so this first
 *     gesture starts it automatically.
 *  3. A small floating button lets the user toggle the audio on/off. Tapping
 *     the button as the very first gesture starts the audio instead of
 *     toggling it off.
 */
export function BackgroundAudio({
  src = "/audio/ambient-space.mp3",
  defaultVolume = 0.35,
  className,
}: BackgroundAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const mediaMode = useMediaStore((s) => s.mode);
  const spotifyUrl = useMediaStore((s) => s.spotifyUrl);

  // React to cross-route media handoff. This is the ONLY <audio> element on
  // the site, and it's already been unlocked by the first user gesture (see
  // the "unlock" effect below) — so reusing it for the Spotify preview lets
  // that preview autoplay immediately, even on Safari, where a brand-new
  // <audio> element created later (e.g. inside SpotifyPlayer) would need its
  // own fresh gesture and couldn't autoplay.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (mediaMode === "spotify" && spotifyUrl) {
      audio.loop = true;
      audio.muted = false;
      if (audio.src !== spotifyUrl) {
        audio.src = spotifyUrl;
        audio.currentTime = 0;
      }
      audio.play().catch(() => {
        // If the browser still blocks it, SpotifyPlayer's "Open in Spotify"
        // link remains as a fallback.
      });
    } else if (mediaMode === "ambient") {
      audio.loop = true;
      const absoluteAmbientSrc = new URL(src, window.location.href).href;
      if (audio.src !== absoluteAmbientSrc) {
        audio.src = src;
      }
      if (enabled && unlocked) {
        audio.muted = false;
        audio.play().catch(() => {
          // Browser may still block if no further user gesture — leave paused.
        });
      } else {
        audio.pause();
      }
    }
  }, [mediaMode, spotifyUrl, enabled, unlocked, ready, src]);

  // Try muted autoplay on mount. This always succeeds.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = defaultVolume;
    audio.muted = true;
    audio.loop = true;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.then(() => setReady(true)).catch(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [defaultVolume]);

  // On the first user interaction outside the audio button, mark audio as
  // unlocked so playback can begin without forcing the user to hit the button.
  useEffect(() => {
    const unlock = (e: Event) => {
      const target = "target" in e ? (e.target as Node | null) : null;
      if (buttonRef.current && target && buttonRef.current.contains(target)) {
        return;
      }
      setUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const toggle = () => {
    if (!unlocked) {
      // First tap on the button itself starts the audio.
      setUnlocked(true);
      return;
    }
    setEnabled((prev) => !prev);
  };

  return (
    <>
      <audio ref={audioRef} src={src} preload="auto" />
      {mediaMode === "ambient" && (
        <button
          ref={buttonRef}
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
