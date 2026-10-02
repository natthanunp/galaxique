import { readFile } from "fs/promises";
import path from "path";

import {
  catalogSnapshotSchema,
  knowledgeFileSchema,
  SELECTABLE_STATUSES,
} from "@/lib/catalogSchema";
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

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog");
let catalogCache: Promise<EnrichedPlaylistCandidate[] | null> | null = null;

async function readCatalog(): Promise<EnrichedPlaylistCandidate[] | null> {
  let approvedRaw: string;
  try {
    approvedRaw = await readFile(path.join(CATALOG_DIR, "approved.json"), "utf-8");
  } catch {
    return null;
  }
  const approved = catalogSnapshotSchema.parse(JSON.parse(approvedRaw));
  const knowledge = knowledgeFileSchema.parse(
    JSON.parse(await readFile(path.join(CATALOG_DIR, "knowledge.json"), "utf-8")),
  );
  return approved.tracks.flatMap((track) => {
    const entry = knowledge[track.track_id];
    const listed = track.status === "active" || (track.status === "removed" && track.retained);
    if (!listed || !entry?.known || !SELECTABLE_STATUSES.has(entry.review_status)) return [];
    return [{ track_id: track.track_id, name: track.name, artist: track.artist, isrc: track.isrc, knowledge: entry }];
  });
}

/** Selectable tracks from the approved snapshot only, never the live playlist.
 *  Null until a snapshot has been approved (scripts/sync-playlist.mjs --approve). */
export function getSelectableCatalog(): Promise<EnrichedPlaylistCandidate[] | null> {
  catalogCache ??= readCatalog().catch((error) => {
    catalogCache = null;
    throw error;
  });
  return catalogCache;
}
