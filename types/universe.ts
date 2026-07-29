/** Shared types for the Galaxique universe visualizer. */

/** UI language, selected on the landing page and threaded through the flow. */
export type Language = "en" | "th";

/** A single multiple-choice answer option, authored in the request's language. */
export interface QuizOption {
  text: string;
}

/** A single quiz question, authored in one language (chosen on the landing
 *  page before the quiz starts), with exactly 4 LLM-generated multiple-choice
 *  options. */
export interface QuizQuestion {
  id: number;
  text: string;
  options: QuizOption[];
}

/** The full quiz payload returned by Gemini call #1. */
export interface QuizPayload {
  questions: QuizQuestion[];
}

/** A user's answer to a question, keyed by question id. */
export interface QuizAnswer {
  questionId: number;
  questionText: string;
  answer: string;
}

/** The dominant emotional texture Gemini assigns to the user. */
export type Vibe = "cute" | "cozy" | "mysterious" | "intense" | "whimsical";

/** Which 3D object renders at the center of the universe. */
export type CelestialType =
  | "galaxy"
  | "black_hole"
  | "neutron_star";

/** A glowing particle shape shown at the core of a cosmic object
 *  (e.g. a heart, a star) — or "none" to let the object speak for itself. */
export type CentralSymbol =
  | "star"
  | "heart"
  | "none";

/** Creature kinds accepted from both new and pre-existing persisted reveals.
 *  New LLM output is restricted to the local GLB-backed kinds in lib/schemas. */
export type CreatureKind =
  | "fish"
  | "bird"
  | "fox"
  | "cat"
  | "dragon"
  | "jelly"
  | "spirit";

/** Optional accessories / silhouettes on top of the base creature. */
export type CreatureAccent =
  | "none"
  | "horns"
  | "ears"
  | "tail"
  | "fins"
  | "halo"
  | "wings";

/** How the creature moves around the scene. */
export type CreatureMotion =
  | "swim"
  | "fly"
  | "orbit"
  | "bob";

/** The LLM-authored creature spec. New responses are validated against the
 *  local GLB-backed subset; the full union supports existing persisted reveals. */
export interface CreatureSpec {
  kind: CreatureKind;
  accent: CreatureAccent;
  motion: CreatureMotion;
  /** Optional short name the LLM gives the creature (e.g. "Mira", "Lumi"). */
  name?: string;
}

/** Ambient dust density around the central object. */
export type ParticleDensity = "high" | "medium" | "low";

/** LLM-authored, renderer-safe morphology for a generated spiral galaxy. */
export interface GalaxyVisualConfig {
  seed: number;
  morphology: "grand_design" | "flocculent" | "barred" | "ringed";
  arm_count: number;
  arm_tightness: number;
  bulge_strength: number;
  disc_thickness: number;
  dust_prominence: number;
  stellar_temperature: "warm" | "balanced" | "cool";
}

/** Renderer-safe black-hole controls used by the accretion disk and lensing pass. */
export interface BlackHoleVisualConfig {
  seed: number;
  disc_tilt: number;
  accretion_activity: number;
  lens_strength: number;
  photon_ring_strength: number;
}

/** Renderer-safe neutron-star controls. */
export interface NeutronStarVisualConfig {
  seed: number;
  pulse_intensity: number;
  jet_length: number;
  magnetic_tilt: number;
}

/** A discriminated render blueprint authored by the LLM and clamped by Zod. */
export type CelestialVisualConfig =
  | { celestial_type: "galaxy"; galaxy: GalaxyVisualConfig }
  | { celestial_type: "black_hole"; black_hole: BlackHoleVisualConfig }
  | { celestial_type: "neutron_star"; neutron_star: NeutronStarVisualConfig };

/** The full reveal payload returned by LLM call #2 — drives the 3D scene + Spotify. */
export interface UniverseReveal {
  vibe: Vibe;
  celestial_type: CelestialType;
  central_symbol: CentralSymbol;
  /** LLM-generated procedural creature companion. Optional for back-compat. */
  creature?: CreatureSpec;
  primary_color: string;
  secondary_color: string;
  rotation_speed: number;
  particle_density: ParticleDensity;
  /** Optional during the persisted-store migration; required for new LLM output. */
  celestial_config?: CelestialVisualConfig;
  /** Exact track selected from the configured Spotify playlist, when available. */
  spotify_track_id?: string | null;
  spotify_search_query: string;
  /** 3-sentence poetic reading, authored directly in the request's language
   *  (language now only switches on the landing page, before the quiz
   *  starts — /reveal no longer needs both languages simultaneously). */
  personality_reading: string;
}

/** Compact playlist catalog entry supplied to the reveal LLM. */
export interface SpotifyPlaylistCandidate {
  track_id: string;
  name: string;
  artist: string;
}

/** Factual semantic descriptor for one playlist track, produced offline by
 *  `scripts/generate-song-knowledge.mjs` and cached in `data/songKnowledge.json`.
 *  This gives the song-selection LLM authored, reviewable facts about a
 *  track's actual lyrical premise and sound instead of asking it to recall
 *  (and risk hallucinating) song meaning fresh on every quiz request. */
export interface SongKnowledgeEntry {
  name: string;
  artist: string;
  /** False when the generation model wasn't confident enough about this
   *  specific song's real lyrical content to describe it — the selector
   *  should treat these as low-confidence/last-resort candidates. */
  known: boolean;
  /** 2-4 short theme tags (e.g. "romantic yearning", "solitude"). */
  themes: string[];
  /** Short relationship stance, e.g. "heartbreak", "secure closeness". */
  relationship_stance: string;
  /** Short mood phrase, e.g. "hazy, wistful". */
  mood: string;
  /** Short energy phrase, e.g. "still, intimate" or "driving, euphoric". */
  energy: string;
  /** Short setting/scene phrase, e.g. "late-night, alone". */
  setting: string;
  /** One sentence: lyrical premise + sonic character, no lyric quotes. */
  summary: string;
  /** True when this descriptor came from a web-search-grounded pass (the
   *  generation model wasn't confident from memory alone — mostly affects
   *  non-English/niche tracks) rather than the model's direct recall. */
  grounded?: boolean;
  /** The single best-fit vibe for this track's overall emotional character,
   *  mapping to the app's vibe enum. Lets the reveal LLM score song
   *  candidates deterministically instead of inferring from free-text
   *  mood/energy fields. Required when known:true. */
  vibe?: "cute" | "cozy" | "mysterious" | "intense" | "whimsical";
  /** 1-2 celestial types this song's vibe naturally pairs with, e.g.
   *  ["black_hole"] for a dark, inward track or ["neutron_star"] for a
   *  high-energy one. Lets the LLM see which cosmic object a track suits. */
  celestial_affinity?: ("galaxy" | "black_hole" | "neutron_star")[];
  /** 1-5 intensity scale (1 = still/ambient, 3 = mid-tempo, 5 = driving/
   *  euphoric) for precise energy matching beyond free-text. */
  intensity?: number;
  /** True if this is a Thai-language song or a Thai artist targeting a Thai
   *  audience. Used to filter the catalog by UI language: English users get
   *  only non-Thai songs; Thai users get the full catalog. Replaces the
   *  fragile script-detection heuristic in app/api/analyze/route.ts. */
  is_thai?: boolean;
}

/** A playlist candidate merged with its cached knowledge descriptor, if any. */
export interface EnrichedPlaylistCandidate extends SpotifyPlaylistCandidate {
  knowledge?: SongKnowledgeEntry;
}

/** Spotify track resolved from the search query (returned to the client). */
export interface SpotifyTrack {
  track_id: string;
  name: string;
  artist: string;
  embed_url: string;
  /** Direct 30s preview audio URL (MP3 from Spotify, or AAC/M4A fallback
   *  from iTunes Search when Spotify has none — see lib/spotify.ts). Null
   *  only if no preview exists on either source. Used for reliable autoplay
   *  on the reveal page (the Spotify iframe `?autoplay=1` is unreliable). */
  preview_url: string | null;
  /** Album art image URL (~300px), used in the "Now playing" card and
   *  composited onto the exported share video. Null if Spotify returned no
   *  album images. */
  album_art_url: string | null;
}
