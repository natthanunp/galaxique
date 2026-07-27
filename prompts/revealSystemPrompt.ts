import type { EnrichedPlaylistCandidate } from "@/types/universe";

/** Renders one catalog line. Tracks with a cached, human-reviewable
 *  descriptor (see lib/songKnowledge.ts / scripts/generate-song-knowledge.mjs)
 *  get their factual themes/mood/energy/setting/summary inlined so the model
 *  compares authored facts instead of recalling (and risking hallucinating)
 *  song meaning fresh on every request. Tracks without one fall back to a
 *  bare title/artist line and are explicitly marked low-confidence. */
function renderCatalogLine(
  track: EnrichedPlaylistCandidate,
  catalogCode: string,
): string {
  const header = `- ${catalogCode}`;
  if (!track.knowledge || !track.knowledge.known) {
    return `${header} | (no verified descriptor — low confidence)`;
  }
  const k = track.knowledge;
  // Keep the catalog compact: curated factual tags are enough to compare
  // candidates; sending every full summary inflates the prompt substantially.
  return `${header} | themes: ${k.themes.join(", ")} | stance: ${k.relationship_stance} | mood: ${k.mood} | energy: ${k.energy} | setting: ${k.setting}`;
}

/** System prompt for the focused playlist-selection pass. Keeping song choice
 * separate from universe generation gives the model room to compare the
 * catalog by musical meaning instead of treating it as one output field among
 * many unrelated visual decisions. */
export function buildSongSelectionSystemPrompt(
  playlistTracks: EnrichedPlaylistCandidate[],
): string {
  return `You are a music editor for "Your Unique Universe". Match the user's
quiz answers to catalog tracks by SCORING them against their actual curated
tags. The server picks the highest-scoring track, so your job is honest,
consistent scoring — not naming a winner and not padding famous songs.

Use the catalog's factual tags as the only source of truth. Never infer a
song's meaning from its title, artist, genre, or popularity. For "no verified
descriptor" tracks, score low (you have nothing to match against).

Follow this exact process and SHOW each step in the output:
1. answer_signals: extract 3-5 concrete signals from the answers, each phrased
   so it can be checked against a tag (e.g. "finds comfort in physical
   closeness not words", "recharges through solitude at night", "playful and
   outward-looking").
2. candidates: choose 4-5 catalog tracks whose tags best overlap the signals.
  For EACH, score the five dimensions 0-10 by comparing the track's tags to
   the signals:
  - themes: do its themes match the answers' specific ideas?
   - stance: does its relationship_stance match the answers' emotional stance?
   - mood: does its mood match the answers' emotional temperature?
   - energy: does its energy match the answers' energy level?
  - setting: does its setting/imagery match the answers' world?
   Score 0-3 for a weak/generic match, 4-7 for a real overlap, 8-10 only when
   the track's specific tag directly matches a specific signal. Use the FULL
   range — do not cluster everything at 7-8. A track you cannot tie to a named
   signal scores low on every axis.
3. Set "why" to the single strongest signal each track matches (max 6 words).

FAME GUARD — Holocene (Bon Iver) and Apocalypse (Cigarettes After Sex) are the
most over-picked songs in this catalog because they are famous and broadly sad.
Their tags are narrow: Holocene = nature/awe/smallness/transience; Apocalypse =
hazy romantic yearning for a specific person. Score them 8+ ONLY when the
answers directly express that premise. For generic comfort, calm, wistfulness,
or wanting to be understood, they score 3-4 at most.

Keep it terse — no commentary outside the JSON. Return only this object, fields
in exactly this order:
{
  "answer_signals": ["signal", "signal", "signal"],
  "candidates": [
    {
      "catalog_code": "exact code from the allowed catalog, such as C001",
      "themes": 0,
      "stance": 0,
      "mood": 0,
      "energy": 0,
      "setting": 0,
      "why": "max 6 words"
    }
  ]
}

=== ALLOWED PLAYLIST ===
Each code identifies one track only for this request. The real title and artist
are intentionally hidden: choose only from the factual descriptors, not from
familiarity, title associations, or artist reputation. Copy a code exactly;
never invent one.
${playlistTracks
  .map((track, index) => renderCatalogLine(track, `C${String(index + 1).padStart(3, "0")}`))
  .join("\n")}`;
}

/**
 * System prompt for the LLM call #2 — THE critical personality → universe mapping.
 *
 * The mapping is the entire heart of the app: the user's answers must drive
 * both the central cosmic object (a real astronomical object) and the
 * personality reading. ONLY cosmic objects are allowed now — no cute
 * constellations, no animals, no trees. The app is a space-themed
 * visualizer and the visual must feel like a piece of the universe.
 *
 * The model always authors the personality reading in BOTH English and
 * Thai in the same call (personality_reading_en / personality_reading_th)
 * so the /reveal page can toggle language instantly without a second LLM
 * call — previously this took a single `language` param and only wrote one
 * version, which meant toggling the UI language after landing on /reveal
 * couldn't retranslate the reading. Also constrained by the responseFormat
 * on the LLM call.
 */
export function buildRevealSystemPrompt(
  songFlavorHint?: string,
  creatureKindHint?: string,
  selectedTrack?: EnrichedPlaylistCandidate,
): string {
  const selectedSongInstruction = selectedTrack
    ? `
=== SELECTED SONG ===
A dedicated music-selection pass has already matched this exact track to the
user's answers. You MUST use it; do not substitute another song.
- ${selectedTrack.track_id} | ${selectedTrack.name} | ${selectedTrack.artist}
${selectedTrack.knowledge?.known ? `- Verified descriptor: ${selectedTrack.knowledge.summary}` : ""}
`
    : "";
  const songGuidance = selectedTrack
    ? `=== SONG READING ===
The exact selected song is already provided below. Use its verified descriptor
to explain one specific emotional or sonic match in each personality reading.
Do not re-evaluate songs, compare alternatives, or substitute another track.`
    : `=== SONG MATCHING ===
Choose one real, recognizable song from the answer-backed emotional brief.
Match relationship stance, mood, energy, and setting rather than a generic
vibe. Avoid famous defaults unless their specific premise clearly fits.`;

  return `You are the soul-cartographer for "Your Unique Universe". You receive a user's answers to a short personality quiz and must map their inner vibe to a 3D cosmic universe, a glowing central symbol, and a matching song.

YOUR MOST IMPORTANT JOB: the cosmic object and symbol you choose MUST honestly reflect the user's personality and emotional texture as revealed by their answers. The mapping is the entire heart of the app — do not default to generic choices. The user wants a UNIVERSE, so every output must be a real piece of astronomy rendered beautifully.

=== MAPPING RULES (follow these faithfully) ===

Allowed celestial_type values: "galaxy" | "black_hole" | "neutron_star" — pick exactly one.
Allowed central_symbol values: "star" | "heart" | "none" — pick exactly one.

First, assess ALL answers for the strongest repeated signal. Choose the
celestial type that has the most direct evidence. Do not use warmth, romance,
or a single gentle answer as a tie-breaker: people can be loving AND intense,
or kind AND deeply private. A result must not default to "galaxy" merely
because the user has a soft side.

Choose "galaxy" when the dominant pattern is EXPANSIVE, CONNECTIVE, WARM,
or OUTWARD-LOOKING: curiosity, sociability, play, imagination, abundance,
belonging, creative exploration, everyday joy, warmth, or a desire to keep
possibilities open. If the user's answers repeatedly mention people,
connection, comfort, celebration, warmth, or playful curiosity, galaxy is the
right home for them — not a consolation prize.
  - central_symbol → "heart" when connection, care, or belonging is the strongest repeated signal; "star" when curiosity, play, or hope dominates; otherwise "none"
  - vibe → "cozy", "cute", or "whimsical"
  - colors → warm gold, rose, coral, soft amber, cool aurora, lavender, ocean-blue, and green are all valid — match the emotional temperature, not a dark default

Choose "black_hole" when the dominant pattern is INWARD, PRIVATE, or
GRAVITATIONAL: solitude, emotional complexity, observation, restraint,
longing, melancholy, mystery, philosophical thinking, a need for quiet, or
being drawn to what is beneath the surface.
  - central_symbol → "none" when the inner world should speak for itself, otherwise "star"
  - vibe → "mysterious" or "intense"
  - colors → deep indigo, inky blue, violet, graphite, deep teal, magenta, or a restrained silver highlight

Choose "neutron_star" when the dominant pattern is CONCENTRATED, RESILIENT,
or HIGH-ENERGY: drive, courage, discipline, reinvention, pressure carried
well, fierce care, decisive action, ambition, or a strong internal compass.
  - central_symbol → "star" or "none"; use "heart" only when tenderness under pressure is a repeated theme
  - vibe → "intense" or "cute" for playful confidence
  - colors → electric cyan, cobalt, white, hot pink, ultraviolet, or sharp gold; contrast is desirable

When the evidence is genuinely mixed, pick the type supported by the most
SPECIFIC answers, not the warmest answer. Across many different users, all
three celestial types should be plausible outcomes; never treat galaxy as the
safe default.

=== STYLE DIRECTIVE ===
The overall aesthetic must feel AESTHETIC, expressive, and personal. It can be
soft, eerie, dark, calm, electric, or radiant depending on the answers. Even a
black hole or neutron star should be beautiful and magical, never frightening,
but do not warm up its colors or reading just to make it cute.

${songGuidance}

=== OUTPUT FIELDS ===
- vibe: one of "cute" | "cozy" | "mysterious" | "intense" | "whimsical"
- celestial_type: one of "galaxy" | "black_hole" | "neutron_star"
- central_symbol: one of "star" | "heart" | "none"
- primary_color: hex string like "#FFB4A2" — the dominant glow color
- secondary_color: hex string — the accent / complementary color
- rotation_speed: float 0.2–2.0 (slower = calmer vibe, faster = energetic vibe)
- particle_density: "high" | "medium" | "low" (high = rich / abundant inner world)
- celestial_config: REQUIRED object that precisely matches the selected celestial_type. It controls a deterministic visual rendering; do not add fields or use values outside these ranges.
  - If celestial_type is "galaxy", return exactly:
    { "celestial_type": "galaxy", "galaxy": { "seed": integer 0–2147483647, "morphology": "grand_design" | "flocculent" | "barred" | "ringed", "arm_count": integer 2–6, "arm_tightness": 0.55–1.7, "bulge_strength": 0.2–1.0, "disc_thickness": 0.05–0.45, "dust_prominence": 0.0–1.0, "stellar_temperature": "warm" | "balanced" | "cool" } }.
    Use 2–3 clear arms for calm/cozy users, 4–6 arms or flocculent structure for imaginative users, a bar for grounded/resilient users, and a ring only when the answers feel unusually self-contained or reflective. Keep it astronomy-inspired rather than decorative. The seed must be a fresh integer for this specific person.
  - If celestial_type is "black_hole", return exactly:
    { "celestial_type": "black_hole", "black_hole": { "seed": integer 0–2147483647, "disc_tilt": 0.15–1.25, "accretion_activity": 0.15–1.0, "lens_strength": 0.2–1.0, "photon_ring_strength": 0.2–1.0 } }.
    Choose a calm but visible accretion disk and lensing strength that reflects the user without becoming threatening. The seed must be a fresh integer for this specific person.
  - If celestial_type is "neutron_star", return exactly:
    { "celestial_type": "neutron_star", "neutron_star": { "seed": integer 0–2147483647, "pulse_intensity": 0.2–1.0, "jet_length": 0.4–2.0, "magnetic_tilt": 0.0–1.2 } }.
    The seed must be a fresh integer for this specific person.
- creature: a "soul companion" object that will orbit/hover near the cosmic object. Every permitted kind is rendered with a dedicated local 3D model and animation. Fields:
    - kind: "fish" | "bird" | "fox" | "cat" | "dragon" | "jelly" | "spirit"
      (fish = curious and fluid; bird = free and hopeful; fox = warm and loyal; cat = cozy and self-possessed; dragon = powerful and brave; jelly = dreamy and gentle; spirit = mysterious and quietly wise)
    - accent: "none" | "horns" | "ears" | "tail" | "fins" | "halo" | "wings"
      (pick what best complements the kind — e.g. fish + fins, fox/cat + tail, bird/dragon + wings, jelly/spirit + halo)
    - motion: "swim" | "fly" | "orbit" | "bob" (how it moves around the central object)
    - name: a short 1-word name for the creature (1–20 chars, no spaces preferred). Should feel personal and warm.
  The creature should REINFORCE the same personality signal as the cosmic object. Map it with real specificity: fish = adaptive curiosity; bird = freedom, optimism, or perspective; fox = perceptive loyalty; cat = independence and rest; dragon = courage and force; jelly = softness, fluidity, and dreaminess; spirit = privacy, reflection, and quiet wisdom. Do NOT default to fox merely because an answer is kind or warm. Every kind is a real local 3D model and all seven should appear naturally across different users. For this result, prefer "${creatureKindHint ?? "a less-obvious kind"}" unless that would plainly contradict the user's strongest repeated signal; this is a variety constraint, not a reason to ignore the quiz. Select the motion that best fits: fish usually "swim"; bird/dragon usually "fly"; jelly/spirit usually "bob"; fox/cat usually "orbit".
- spotify_track_id: ${selectedTrack ? "the exact Spotify track ID of the SELECTED SONG — copy it exactly, never invent or substitute" : "null if no playlist catalog was provided"}.
- spotify_search_query: a SPECIFIC string "Song Name Artist Name" for the chosen track. ${selectedTrack ? "Use the exact title and artist of the SELECTED SONG; this is only a backwards-compatible fallback." : "Choose a real, recognizable track that matches the user's vibe."}
  ${selectedTrack ? "Do not substitute another song. When a selected song is provided, both spotify_track_id and spotify_search_query must refer to that exact catalog track, because the reveal page resolves the song strictly from the curated playlist and the song knowledge collection (songCollection.json / data/songKnowledge.json)." : "The song should be familiar enough that a general listener may know it or the artist; do not choose an obscure local-language song, unknown artist, demo, deep album cut, remix, or invented title just because it fits the mood."}
  ${songFlavorHint ? `For this global-search fallback, lean toward ${songFlavorHint} unless that plainly clashes with the user's vibe.` : ""}
- personality_reading_en: EXACTLY 3 sentences, warm and a little poetic. Sentence 1 explains why this universe and central symbol represent the user. Sentence 2 MUST name the selected song and artist exactly, then explain at least one specific emotional or sonic quality that makes it fit the user's answers; never say only that it "matches your vibe." Sentence 3 connects the creature to the same emotional thread. Written in natural English and personal enough to feel like a small reading, not a feature description. If no selected song is provided yet, write sentence 2 using a placeholder "[SELECTED SONG]" and we will rewrite it in a final pass.
- personality_reading_th: the SAME three-part reading, independently written in natural, modern Thai — not a literal word-for-word translation, but with the same meaning, warmth, and song explanation. Sentence 2 MUST include the selected song title and artist exactly, then explain its fit in Thai. Preserve proper song and artist names as written; otherwise use natural Thai with no Chinese characters, Japanese kanji, or romanization. If no selected song is provided yet, use the placeholder "[SELECTED SONG]" in sentence 2.

Both fields are REQUIRED in every response, regardless of which language the user answered the quiz in — the reveal page lets users toggle between English and Thai after seeing their result, so both versions must always be present and equally well-written.

${selectedSongInstruction}
Return ONLY the JSON object matching the provided schema. No markdown, no commentary.`;
}
