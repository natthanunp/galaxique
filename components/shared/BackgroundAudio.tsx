"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { useMediaStore } from "@/store/mediaStore";
import { FLAGS } from "@/config/flags";
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
  const isPlaying = useMediaStore((s) => s.isPlaying);
  const isSuspended = useMediaStore((s) => s.isSuspended);
  const setPlaying = useMediaStore((s) => s.setPlaying);
  const playRequestRef = useRef<Promise<void> | null>(null);
  const wasPlayingBeforeUnfocus = useRef(false);
  const setAmbientEnabled = useMediaStore((s) => s.setAmbientEnabled);
  const setPreviewAudible = useMediaStore((s) => s.setPreviewAudible);
  // Set when the browser refused to start the preview without a gesture; the next gesture retries.
  const blockedRef = useRef(false);
  const fellBackRef = useRef(false);
  useEffect(() => { setAmbientEnabled(enabled); }, [enabled, setAmbientEnabled]);

  // Some browsers (e.g. Electron webviews) cannot decode the AAC preview; swap to the MP3 once.
  const tryFallback = useCallback(() => {
    const state = useMediaStore.getState();
    if (fellBackRef.current || state.mode !== "spotify" || !state.spotifyFallbackUrl) return false;
    fellBackRef.current = true;
    playRequestRef.current = null;
    state.setSpotifyUrl(state.spotifyFallbackUrl);
    state.setSpotifyFallbackUrl(null);
    state.setPlaying(true);
    return true;
  }, []);

  const startPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src || !audio.paused || playRequestRef.current) return;
    audio.muted = false;
    const playRequest = audio.play();
    playRequestRef.current = playRequest;
    playRequest.then(() => {
      blockedRef.current = false;
      if (playRequestRef.current === playRequest) setPlaying(true);
    }).catch((error: DOMException) => {
      if (playRequestRef.current !== playRequest) return;
      // Interrupted by our own pause() or a source swap: the intent stands and the watchdog retries.
      if (error?.name === "AbortError") return;
      if (error?.name === "NotSupportedError" && tryFallback()) return;
      if (error?.name === "NotAllowedError") blockedRef.current = true;
      setPlaying(false);
    }).finally(() => {
      if (playRequestRef.current === playRequest) playRequestRef.current = null;
    });
  }, [setPlaying, tryFallback]);

  useEffect(() => { if (!spotifyUrl) fellBackRef.current = false; }, [spotifyUrl]);

  // React to cross-route media handoff. This is the ONLY <audio> element on
  // the site, and it's already been unlocked by the first user gesture (see
  // the "unlock" effect below) — so reusing it for the Spotify preview lets
  // that preview autoplay immediately, even on Safari, where a brand-new
  // <audio> element created later (e.g. inside SpotifyPlayer) would need its
  // own fresh gesture and couldn't autoplay.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    if (isSuspended || !enabled) {
      // Either suspended by the store (e.g. another view wants silence) or
      // the user clicked the mute button — both mean "stop right now". We
      // keep the existing `playRequestRef` so any in-flight `play()` doesn't
      // accidentally flip `isPlaying` back to true on a later microtask.
      audio.pause();
      playRequestRef.current = null;
      if (isPlaying) setPlaying(false);
      return;
    }
    if (mediaMode === "spotify" && spotifyUrl) {
      audio.loop = true;
      audio.muted = false;
      // audio.src is absolute; comparing it to the relative URL would reload (and pause) the element on every run.
      const absoluteSpotifyUrl = new URL(spotifyUrl, window.location.href).href;
      if (audio.src !== absoluteSpotifyUrl) {
        audio.src = spotifyUrl;
        audio.currentTime = 0;
      }
      if (isPlaying && audio.paused && !playRequestRef.current) {
        startPreview();
      } else if (!isPlaying) {
        audio.pause();
      }
    } else if (mediaMode === "ambient") {
      // The adaptive score (lib/soundtrack) replaces the single loop.
      if (FLAGS.adaptiveSoundtrack) {
        audio.pause();
        return;
      }
      audio.loop = true;
      const absoluteAmbientSrc = new URL(src, window.location.href).href;
      if (audio.src !== absoluteAmbientSrc) {
        audio.src = src;
      }
      if (unlocked) {
        audio.muted = false;
        audio.play().catch(() => {
          // Browser may still block if no further user gesture — leave paused.
        });
      } else {
        audio.pause();
        setPlaying(false);
      }
    }
  }, [mediaMode, spotifyUrl, isPlaying, isSuspended, setPlaying, enabled, unlocked, ready, src, startPreview]);

  // The score may only duck for a preview that is really audible, never for one that failed to start.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audible = () => setPreviewAudible(true);
    const silent = () => setPreviewAudible(false);
    const failed = () => { setPreviewAudible(false); tryFallback(); };
    audio.addEventListener("playing", audible);
    audio.addEventListener("error", failed);
    for (const type of ["pause", "ended", "emptied", "abort"]) audio.addEventListener(type, silent);
    return () => {
      audio.removeEventListener("playing", audible);
      audio.removeEventListener("error", failed);
      for (const type of ["pause", "ended", "emptied", "abort"]) audio.removeEventListener(type, silent);
      setPreviewAudible(false);
    };
  }, [setPreviewAudible, tryFallback]);

  // Watchdog: while a preview is wanted but the element sits paused (aborted load, slow proxy), keep trying.
  useEffect(() => {
    if (!ready || !enabled || isSuspended || !isPlaying || mediaMode !== "spotify" || !spotifyUrl) return;
    let attempts = 0;
    const id = window.setInterval(() => {
      if (document.hidden || ++attempts > 12) return;
      startPreview();
    }, 1000);
    return () => window.clearInterval(id);
  }, [ready, enabled, isSuspended, isPlaying, mediaMode, spotifyUrl, startPreview]);

  // After a blocked autoplay, the visitor's next gesture is the moment the browser allows sound.
  useEffect(() => {
    const retry = (event: Event) => {
      const state = useMediaStore.getState();
      if (!blockedRef.current || state.mode !== "spotify" || !state.spotifyUrl || state.isSuspended) return;
      const target = "target" in event ? (event.target as Node | null) : null;
      if (buttonRef.current && target && buttonRef.current.contains(target)) return;
      blockedRef.current = false;
      state.setPlaying(true);
      startPreview();
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("touchstart", retry);
    window.addEventListener("keydown", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("touchstart", retry);
      window.removeEventListener("keydown", retry);
    };
  }, [startPreview]);

  // Try muted autoplay on mount. This always succeeds.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = defaultVolume;
    audio.muted = true;
    audio.loop = true;
    const p = audio.play();
    // Without a src the browser may leave this promise pending forever, so readiness cannot depend on it.
    if (p && typeof p.catch === "function") p.catch(() => {});
    queueMicrotask(() => setReady(true));
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

  // Pause explicitly when the app loses focus, then resume interrupted audio
  // once the document is visible again.
  useEffect(() => {
    const pauseWhenUnfocused = () => {
      const audio = audioRef.current;
      if (!audio) return;
      // Intent counts too: a play() that was still loading reports paused, and would never resume.
      wasPlayingBeforeUnfocus.current =
        wasPlayingBeforeUnfocus.current || !audio.paused || useMediaStore.getState().isPlaying;
      audio.pause();
      playRequestRef.current = null;
      setPlaying(false);
    };
    const resumeWhenFocused = () => {
      if (
        document.visibilityState !== "visible" ||
        !wasPlayingBeforeUnfocus.current ||
        useMediaStore.getState().isSuspended
      ) {
        return;
      }
      wasPlayingBeforeUnfocus.current = false;
      setPlaying(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseWhenUnfocused();
      else resumeWhenFocused();
    };

    window.addEventListener("blur", pauseWhenUnfocused);
    window.addEventListener("focus", resumeWhenFocused);
    window.addEventListener("pageshow", resumeWhenFocused);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", pauseWhenUnfocused);
      window.removeEventListener("focus", resumeWhenFocused);
      window.removeEventListener("pageshow", resumeWhenFocused);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [setPlaying]);

  const toggle = () => {
    const audio = audioRef.current;
    // The first user gesture on the page is what unlocks the browser's
    // autoplay policy. When that very first gesture is the mute button
    // itself, we have to honor the user's intent (mute) AND satisfy the
    // gesture requirement, otherwise the button looks broken on the very
    // first click — the song would keep playing and the icon wouldn't
    // change until the second click. So: first click = unlock + mute (if
    // the audio is currently producing sound) or just unlock (if it's
    // already silent, e.g. browser blocked the play()).
    if (!unlocked) {
      setUnlocked(true);
      if (audio && ready && enabled) {
        // Currently unmuted → mute. Same code path as the regular mute
        // branch below; inlined here so a first-click unlock still
        // mutes the song that's already playing.
        audio.pause();
        playRequestRef.current = null;
        setPlaying(false);
        setEnabled(false);
      }
      return;
    }
    if (!audio || !ready) {
      // No audio element yet (SSR-ish state) — just flip the flag and let
      // the player effect sync up once it mounts.
      setEnabled((prev) => !prev);
      return;
    }
    // Drive the audio element directly so play/pause stays in lockstep with
    // the icon, and update the store so the rest of the app sees the new
    // state immediately (no waiting for the player effect to re-run).
    if (enabled) {
      // Currently unmuted → mute: pause and clear isPlaying so the player
      // effect doesn't auto-resume us.
      audio.pause();
      playRequestRef.current = null;
      setPlaying(false);
      setEnabled(false);
    } else {
      // Currently muted → unmute: re-enable and ask the store to play.
      // For the spotify preview this triggers a fresh play() at the
      // currentTime (so the song resumes from where it was paused, not
      // from 0); for the ambient loop it lets the existing player
      // effect start the loop on the next tick.
      audio.muted = false;
      setEnabled(true);
      if (mediaMode === "spotify" && spotifyUrl) {
        setPlaying(true);
      }
    }
  };

  return (
    <>
      <audio ref={audioRef} src={FLAGS.adaptiveSoundtrack ? undefined : src} preload={FLAGS.adaptiveSoundtrack ? "none" : "auto"} />
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={
          mediaMode === "spotify"
            ? enabled
              ? "Mute song"
              : "Play song"
            : enabled
              ? "Mute ambient audio"
              : "Play ambient audio"
        }
        title={
          mediaMode === "spotify"
            ? enabled
              ? "Mute song"
              : "Play song"
            : enabled
              ? "Mute ambient audio"
              : "Play ambient audio"
        }
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
    </>
  );
}
