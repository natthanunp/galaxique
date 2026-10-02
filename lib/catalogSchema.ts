import { z } from "zod";

/** Playlist catalog snapshot written by scripts/sync-playlist.mjs. */
export const catalogTrackSchema = z.object({
  track_id: z.string().min(1),
  isrc: z.string().nullable(),
  name: z.string(),
  artist: z.string(),
  added_at: z.string().nullable(),
  status: z.enum(["active", "unavailable", "local", "episode", "duplicate", "removed"]),
  /** Removed tracks referenced by history stay selectable only when explicitly retained. */
  retained: z.boolean().optional(),
  /** Earlier track IDs matched to this track by ISRC (relinked/replaced). */
  aliases: z.array(z.string()).optional(),
});
export type CatalogTrack = z.infer<typeof catalogTrackSchema>;

export const catalogSnapshotSchema = z.object({
  version: z.literal(1),
  playlist_id: z.string(),
  synced_at: z.string(),
  tracks: z.array(catalogTrackSchema),
});
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export const REVIEW_STATUSES = ["legacy", "draft", "reviewed", "native-reviewed"] as const;
/** Statuses allowed in new selections. `legacy` and `draft` stay selectable until a reviewer corrects or rejects them. */
export const SELECTABLE_STATUSES = new Set<string>(["legacy", "draft", "reviewed", "native-reviewed"]);

export const knowledgeEntrySchema = z.object({
  knowledge_version: z.literal(2),
  name: z.string(),
  artist: z.string(),
  isrc: z.string().nullable().optional(),
  known: z.boolean(),
  review_status: z.enum(REVIEW_STATUSES),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.object({
    type: z.enum(["model-recall", "web-search", "legacy-import", "owner", "reviewer"]),
    ref: z.string().optional(),
  })),
  lyrics: z.enum(["present", "none", "unknown"]),
  /** Primary vocal language (ISO 639-1) or "none" for instrumentals; unset until verified. */
  lyric_language: z.string().regex(/^([a-z]{2}|none)$/).optional(),
  /** Edge case awaiting an owner decision, e.g. a Thai artist singing mainly in English. */
  language_flag: z.enum(["thai-artist-other-language", "mixed-language", "uncertain"]).optional(),
  /** Legacy Thai flag; used only while lyric_language is unset. */
  is_thai: z.boolean().optional(),
  themes: z.array(z.string()),
  relationship_stance: z.string(),
  mood: z.string(),
  /** Reviewed musical energy; never sourced from Spotify audio features. */
  energy: z.string(),
  intensity: z.number().int().min(1).max(5).optional(),
  setting: z.string(),
  summary: z.string(),
  notes: z.string().optional(),
});
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

export const knowledgeFileSchema = z.record(z.string(), knowledgeEntrySchema);
