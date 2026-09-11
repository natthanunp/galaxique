import type { Assessment } from "@/lib/profileAssessment";
import type { EnrichedPlaylistCandidate } from "@/types/universe";

const STOP = new Set(["a", "an", "the", "and", "of", "in", "on", "to", "with", "is", "for", "or"]);
const terms = (s: string) => new Set(s.toLowerCase().match(/[a-z]+/g)?.filter(t => !STOP.has(t)) ?? []);
const FIELDS = ["themes", "stance", "mood", "energy", "setting"] as const;
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
    return { track, score: available ? 55 * total / available : 0 };
  }).sort((a, b) => b.score - a.score || a.track.track_id.localeCompare(b.track.track_id));
}
export function selectSong(
  ranked: ReturnType<typeof rankSongs>, sessionRecent: readonly string[] = [], globalRecent: readonly string[] = [],
) {
  if (!ranked.length) return undefined;
  // Diversity may only choose among songs within five points of the best fit.
  const nearBest = ranked.filter(r => r.score >= ranked[0].score - 5);
  const unseen = nearBest.filter(r => !sessionRecent.includes(r.track.track_id));
  const pool = unseen.length ? unseen : nearBest;
  return [...pool].sort((a, b) => {
    const adjusted = (r: typeof a) => r.score - Math.min(2, globalRecent.filter(id => id === r.track.track_id).length * 0.5);
    return adjusted(b) - adjusted(a) || b.score - a.score || a.track.track_id.localeCompare(b.track.track_id);
  })[0];
}
