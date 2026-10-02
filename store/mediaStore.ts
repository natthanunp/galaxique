"use client";

import { create } from "zustand";

/**
 * Cross-route audio control. Lives outside `useQuizStore` so it never gets
 * persisted to localStorage — this is purely runtime signalling between the
 * site-wide BackgroundAudio player and page-specific players (e.g. the
 * Spotify embed on /reveal).
 *
 * Convention:
 *  - `mode === "ambient"` (default): BackgroundAudio plays the loop.
 *  - `mode === "spotify"`: BackgroundAudio ducks to silence and pauses, so
 *    the Spotify embed can take over without two tracks layering.
 */
interface MediaState {
  mode: "ambient" | "spotify";
  /** The Spotify preview MP3 URL to play once `mode === "spotify"`. Playing
   *  it through the same, already-gesture-unlocked <audio> element that
   *  BackgroundAudio owns lets it autoplay reliably, even on Safari, where a
   *  brand-new <audio> element would require its own fresh user gesture. */
  spotifyUrl: string | null;
  /** MP3 to switch to when the browser cannot decode `spotifyUrl` (AAC). */
  spotifyFallbackUrl: string | null;
  isPlaying: boolean;
  isSuspended: boolean;
  /** True only while the shared <audio> is truly producing the preview, unlike `isPlaying` (the intent). */
  previewAudible: boolean;
  /** The visitor's ambient sound toggle; the adaptive soundtrack follows it too. */
  ambientEnabled: boolean;
  /** Resolved track metadata, set by SpotifyPlayer once it has a match.
   *  Read by ShareButton to composite album art + song name onto the
   *  exported share video (and to mux the preview audio into it). */
  track: { name: string; artist: string; albumArtUrl: string | null } | null;
  setMode: (mode: MediaState["mode"]) => void;
  setSpotifyUrl: (url: string | null) => void;
  setSpotifyFallbackUrl: (url: string | null) => void;
  setPlaying: (isPlaying: boolean) => void;
  setSuspended: (isSuspended: boolean) => void;
  setPreviewAudible: (previewAudible: boolean) => void;
  setAmbientEnabled: (ambientEnabled: boolean) => void;
  setTrack: (track: MediaState["track"]) => void;
}

export const useMediaStore = create<MediaState>((set) => ({
  mode: "ambient",
  spotifyUrl: null,
  spotifyFallbackUrl: null,
  isPlaying: false,
  isSuspended: false,
  previewAudible: false,
  ambientEnabled: true,
  track: null,
  setMode: (mode) => set({ mode }),
  setSpotifyUrl: (spotifyUrl) => set({ spotifyUrl }),
  setSpotifyFallbackUrl: (spotifyFallbackUrl) => set({ spotifyFallbackUrl }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSuspended: (isSuspended) => set({ isSuspended }),
  setPreviewAudible: (previewAudible) => set({ previewAudible }),
  setAmbientEnabled: (ambientEnabled) => set({ ambientEnabled }),
  setTrack: (track) => set({ track }),
}));
