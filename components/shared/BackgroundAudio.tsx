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
 * Browsers refuse to autoplay with sound on. The trick this component uses:
 *  1. Mount the <audio> element with `muted` and try `play()` immediately —
 *     muted autoplay is always allowed.
 *  2. The FIRST user interaction (click / keydown / touch) unmutes the audio
 *     and we attempt playback again.
 *  3. A small floating button lets the user toggle the audio on/off.
 *
 * The component is silent in SSR (the audio element only exists after mount).
 */
export function BackgroundAudio({
  src = "/audio/ambient-space.mp3",
  defaultVolume = 0.35,
  className,
}: BackgroundAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const mediaMode = useMediaStore((s) => s.mode);
  const spotifyUrl = useMediaStore((s) => s.spotifyUrl);

  // React to cross-route media handoff. This is the ONLY <audio> element on
  // the site, and it's already been unlocked by the first user gesture (see
  // the "arm" effect below) — so reusing it for the Spotify preview lets
  // that preview autoplay immediately, even on Safari, where a brand-new
  // <audio> element created later (e.g. inside SpotifyPlayer) would need its
  // own fresh gesture and couldn't autoplay.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
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
      if (enabled) {
        audio.muted = false;
        audio.play().catch(() => {
          // Browser may still block if no further user gesture — leave paused.
        });
      } else {
        audio.pause();
      }
    }
  }, [mediaMode, spotifyUrl, enabled, src]);


  // Try muted autoplay on mount. This always succeeds.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = defaultVolume;
    audio.muted = true;
    audio.loop = true;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.then(() => setReady(true)).catch(() => {
        // Muted autoplay should never fail, but be defensive.
        setReady(false);
      });
    } else {
      setReady(true);
    }
  }, [defaultVolume]);

  // On the first user interaction anywhere, unmute and try to start playback.
  useEffect(() => {
    const arm = () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.muted = false;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.then(() => setEnabled(true)).catch(() => {
          // Still blocked — user can toggle manually.
        });
      } else {
        setEnabled(true);
      }
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    window.addEventListener("touchstart", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (enabled) {
      audio.pause();
      setEnabled(false);
    } else {
      audio.muted = false;
      audio
        .play()
        .then(() => {
          setEnabled(true);
          setMuted(false);
        })
        .catch(() => {
          // Last-resort: keep muted if real playback is blocked.
          audio.muted = true;
          setMuted(true);
        });
    }
  };

  return (
    <>
      <audio ref={audioRef} src={src} preload="auto" />
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
