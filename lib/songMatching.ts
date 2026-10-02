import { conceptsIn } from "@/lib/conceptVocabulary";
import type { Assessment } from "@/lib/profileAssessment";
import type { EnrichedPlaylistCandidate, Language } from "@/types/universe";

/** Thai song = Thai is the primary lyric language. Unreviewed entries fall back to the legacy flag. */
export function isThaiSong(track: EnrichedPlaylistCandidate): boolean {
  const k = track.knowledge;
  if (k?.lyric_language) return k.lyric_language === "th";
  return k?.is_thai ?? /\p{Script=Thai}/u.test(track.name + track.artist);
}

/** Hard filter applied before ranking: Thai users get every song, English users never get Thai songs. */
export function eligibleForLanguage(tracks: EnrichedPlaylistCandidate[], language: Language) {
  return language === "th" ? tracks : tracks.filter((track) => !isThaiSong(track));
}

const STOP = new Set(["a", "an", "the", "and", "of", "in", "on", "to", "with", "is", "for", "or"]);
/** Exact words plus shared concept IDs, so synonyms and Thai descriptors can match. */
const terms = (s: string) => {
  const out = new Set(s.toLowerCase().match(/[a-z]+/g)?.filter(t => !STOP.has(t)) ?? []);
  for (const concept of conceptsIn(s)) out.add(`concept:${concept}`);
  return out;
};
const FIELDS = ["themes", "stance", "mood", "energy", "setting"] as const;

/** Human-reviewed entries count fully; unverified descriptors are discounted so better-evidenced songs win close calls. */
function evidenceTrust(k: NonNullable<EnrichedPlaylistCandidate["knowledge"]>): number {
  if (!k.review_status || k.review_status === "reviewed" || k.review_status === "native-reviewed") return 1;
  const searched = k.sources?.some(s => s.type === "web-search") ?? k.grounded ?? false;
  return searched ? 0.95 : 0.9;
}
/** Full-catalog retrieval on answer-derived English tags. Legacy vibe/celestial labels are deliberately excluded. */
export function rankSongs(tracks: EnrichedPlaylistCandidate[], brief: Assessment["song_brief"]) {
  const documents = tracks.filter(t => t.knowledge?.known).map(track => {
    const k = track.knowledge!;
    return { track, fields: { themes: terms(k.themes.join(" ")), stance: terms(k.relationship_stance), mood: terms(k.mood), energy: terms(k.energy), setting: terms(k.setting) } };
  });
  const frequency = new Map<string, number>();
  for (const d of documents) for (const word of new Set(FIELDS.flatMap(f => [...d.fields[f]]))) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const weight = (word: string) => Math.log(1 + documents.length / (1 + (frequency.get(word) ?? 0)));
  const query = Object.fromEntries(FIELDS.map(f => [f, terms(brief[f].join(" "))])) as Record<typeof FIELDS[number], Set<string>>;
  return documents.map(({ track, fields }) => {
    let total = 0, available = 0;
    for (const f of FIELDS) {
      if (!query[f].size) continue;
      const multiplier = f === "stance" ? 1.5 : 1;
      const denominator = [...query[f]].reduce((sum, word) => sum + weight(word), 0);
      const overlap = [...query[f]].reduce((sum, word) => sum + (fields[f].has(word) ? weight(word) : 0), 0);
      total += multiplier * overlap / denominator;
      available += multiplier;
    }
    return { track, score: available ? 55 * total / available * evidenceTrust(track.knowledge!) : 0 };
  }).sort((a, b) => b.score - a.score || a.track.track_id.localeCompare(b.track.track_id));
}
export type RankedSong = ReturnType<typeof rankSongs>[number];

export interface PickOptions {
  /** Reveal ID; the same seed and inputs always pick the same song. */
  seed: string;
  /** The visitor's own recent tracks (personal cooldown). */
  sessionRecent?: readonly string[];
  /** Time-decayed global selection counts per track. */
  exposure?: Readonly<Record<string, number>>;
}

const SHORTLIST_MAX = 25;
const FRESH_FLOOR = 0.7;

/** Only songs close to the best fit are eligible; variety never rescues a weak match. */
export function shortlistSongs(ranked: readonly RankedSong[]): RankedSong[] {
  if (!ranked.length) return [];
  const best = ranked[0].score;
  const margin = Math.max(8, best * 0.25);
  return ranked.filter(r => r.score >= best - margin).slice(0, SHORTLIST_MAX);
}

function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortlist → personal cooldown, artist diversity, global exposure → seeded weighted choice. */
export function pickSong(ranked: readonly RankedSong[], options: PickOptions) {
  const recent = new Set(options.sessionRecent ?? []);
  // Rank before shortlisting so a repeat visitor with a consistent brief walks down the catalog instead of cycling the same top songs.
  const fit = shortlistSongs(ranked);
  if (!fit.length) return undefined;
  const fresh = shortlistSongs(ranked.filter(r => !recent.has(r.track.track_id)));
  // Unheard songs are only used while they stay reasonably close to the best fit.
  const shortlist = fresh.length && fresh[0].score >= fit[0].score * FRESH_FLOOR ? fresh : fit;
  const recentArtists = new Set(ranked.filter(r => recent.has(r.track.track_id)).map(r => r.track.artist));
  const exposure = options.exposure ?? {};
  const best = shortlist[0].score;
  const weights = shortlist.map(r => {
    let weight = ((r.score + 1) / (best + 1)) ** 3;
    if (recent.has(r.track.track_id)) weight *= 0.03;
    else if (recentArtists.has(r.track.artist)) weight *= 0.4;
    // Absolute (not above-mean) so even a handful of picks rotates songs when traffic is low.
    return weight / (1 + (exposure[r.track.track_id] ?? 0));
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = seededRandom(options.seed)() * total;
  const index = weights.findIndex(w => (roll -= w) < 0);
  const chosen = shortlist[index === -1 ? shortlist.length - 1 : index];
  return { ...chosen, shortlist };
}
