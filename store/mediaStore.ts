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
  /** Resolved track metadata, set by SpotifyPlayer once it has a match.
   *  Read by ShareButton to composite album art + song name onto the
   *  exported share video (and to mux the preview audio into it). */
  track: { name: string; artist: string; albumArtUrl: string | null } | null;
  setMode: (mode: MediaState["mode"]) => void;
  setSpotifyUrl: (url: string | null) => void;
  setTrack: (track: MediaState["track"]) => void;
}

export const useMediaStore = create<MediaState>((set) => ({
  mode: "ambient",
  spotifyUrl: null,
  track: null,
  setMode: (mode) => set({ mode }),
  setSpotifyUrl: (spotifyUrl) => set({ spotifyUrl }),
  setTrack: (track) => set({ track }),
}));
