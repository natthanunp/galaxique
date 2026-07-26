import { readFile } from "fs/promises";
import path from "path";

import type {
  EnrichedPlaylistCandidate,
  SongKnowledgeEntry,
  SpotifyPlaylistCandidate,
} from "@/types/universe";

/**
 * Cached, curated song-knowledge layer.
 *
 * Regenerate `data/songKnowledge.json` after the configured playlist changes
 * by running `node scripts/generate-song-knowledge.mjs` (reads `.env.local`,
 * hits the real Spotify playlist + OpenRouter). Entries are keyed by Spotify
 * track ID so lookups stay correct even if a track is renamed on Spotify.
 */

const CACHE_PATH = path.join(process.cwd(), "data", "songKnowledge.json");

let cached: Record<string, SongKnowledgeEntry> | null = null;

async function loadKnowledge(): Promise<Record<string, SongKnowledgeEntry>> {
  if (cached) return cached;
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    cached = JSON.parse(raw) as Record<string, SongKnowledgeEntry>;
  } catch (err) {
    console.warn(
      "[songKnowledge] data/songKnowledge.json missing or unreadable — song " +
        "selection will fall back to bare title/artist for all tracks. Run " +
        "scripts/generate-song-knowledge.mjs to generate it.",
      err,
    );
    cached = {};
  }
  return cached;
}

/** Merge live playlist tracks with their cached descriptors, when present. */
export async function enrichPlaylistTracks(
  tracks: SpotifyPlaylistCandidate[],
): Promise<EnrichedPlaylistCandidate[]> {
  const knowledge = await loadKnowledge();
  return tracks.map((track) => ({
    ...track,
    knowledge: knowledge[track.track_id],
  }));
}
