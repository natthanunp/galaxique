import { z } from "zod";

/** Zod schemas mirroring the Gemini JSON schemas, used to validate model output
 *  at runtime (Gemini guarantees syntactic JSON, but values still need checking). */

function hasDistinctOptionText(options: { text: string }[]): boolean {
  const normalized = options.map((option) =>
    option.text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
  );
  return new Set(normalized).size === normalized.length;
}

export const quizOptionSchema = z.object({
  text: z.string().min(1),
});

export const quizQuestionSchema = z.object({
  id: z.number().int().min(1),
  /** The underlying facet-of-identity this question probes, invented by the
   *  LLM itself (see prompts/quizSystemPrompt.ts). Used server-side to track
   *  "seen" angles for future-call variety; stripped before the question is
   *  sent to the client. */
  angle: z.string().min(1),
  text: z.string().min(1),
  /** Exactly 4 single-language multiple-choice answer options. */
  options: z
    .array(quizOptionSchema)
    .length(4)
    .refine(hasDistinctOptionText, "options must have distinct text"),
});

export const quizPayloadSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1),
});

/** Per-dimension match score for one catalog candidate, 0–10 per axis.
 *  Each axis corresponds to a curated descriptor field in songKnowledge.json,
 *  so the model scores by matching the answer signals against the track's
 *  actual `relationship_stance` / `mood` / `energy` / `setting` tags rather
 *  than emitting one holistic vibe-number (which collapsed to famous defaults
 *  and to meaningless "85" self-confidence). Mechanical per-axis scoring is
 *  what forces genuine descriptor comparison. */
export const dimensionScoreSchema = z.object({
  /** Do the track's curated themes match the specific ideas in the answers? */
  themes: z.number().min(0).max(10),
  /** Does the track's relationship stance match the emotional stance in the
   *  answers (secure closeness vs. yearning vs. heartbreak vs. independence)? */
  stance: z.number().min(0).max(10),
  /** Does the track's emotional temperature match (dreamy/melancholic vs.
   *  joyful vs. defiant vs. restrained)? */
  mood: z.number().min(0).max(10),
  /** Does the track's energy match (still/intimate vs. driving vs. expansive)? */
  energy: z.number().min(0).max(10),
  /** Does the track's setting/imagery match (late-night alone vs. wide-open
   *  landscape vs. bright celebration)? */
  setting: z.number().min(0).max(10),
  /** Max 6 words naming the strongest signal this track matches. */
  why: z.string(),
});

/** One scored catalog candidate, folded directly into the single merged
 *  reveal call (see prompts/revealSystemPrompt.ts "SONG SCORING" section and
 *  app/api/analyze/route.ts). Optional — a malformed/missing shortlist must
 *  not force a retry of the whole reveal response; it just falls through to
 *  the catalog fallback for that attempt. */
export const songCandidateSchema = dimensionScoreSchema.extend({
  /** Opaque code assigned by the server for this prompt. Hiding song
   *  names/artists prevents the model's popularity prior from biasing
   *  descriptor-only comparison. */
  catalog_code: z.string().regex(/^C\d{3}$/),
});

export const creatureSpecSchema = z.object({
  kind: z.enum([
    "fish",
    "bird",
    "fox",
    "cat",
    "dragon",
    "jelly",
    "spirit",
  ]),
  accent: z.enum([
    "none",
    "horns",
    "ears",
    "tail",
    "fins",
    "halo",
    "wings",
  ]),
  motion: z.enum(["swim", "fly", "orbit", "bob"]),
  name: z.string().min(1).max(20).optional(),
});

const galaxyVisualConfigSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_647),
  morphology: z.enum(["grand_design", "flocculent", "barred", "ringed"]),
  arm_count: z.number().int().min(2).max(6),
  arm_tightness: z.number().min(0.55).max(1.7),
  bulge_strength: z.number().min(0.2).max(1),
  disc_thickness: z.number().min(0.05).max(0.45),
  dust_prominence: z.number().min(0).max(1),
  stellar_temperature: z.enum(["warm", "balanced", "cool"]),
});

const blackHoleVisualConfigSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_647),
  disc_tilt: z.number().min(0.15).max(1.25),
  accretion_activity: z.number().min(0.15).max(1),
  lens_strength: z.number().min(0.2).max(1),
  photon_ring_strength: z.number().min(0.2).max(1),
});

const neutronStarVisualConfigSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_647),
  pulse_intensity: z.number().min(0.2).max(1),
  jet_length: z.number().min(0.4).max(2),
  magnetic_tilt: z.number().min(0).max(1.2),
});

export const celestialVisualConfigSchema = z.discriminatedUnion("celestial_type", [
  z.object({ celestial_type: z.literal("galaxy"), galaxy: galaxyVisualConfigSchema }),
  z.object({ celestial_type: z.literal("black_hole"), black_hole: blackHoleVisualConfigSchema }),
  z.object({ celestial_type: z.literal("neutron_star"), neutron_star: neutronStarVisualConfigSchema }),
]);

export const universeRevealSchema = z.object({
  vibe: z.enum(["cute", "cozy", "mysterious", "intense", "whimsical"]),
  celestial_type: z.enum([
    "galaxy",
    "black_hole",
    "neutron_star",
  ]),
  central_symbol: z.enum([
    "star",
    "heart",
    "none",
  ]),
  creature: creatureSpecSchema.optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB hex string"),
  secondary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB hex string"),
  rotation_speed: z.number().min(0.2).max(2),
  particle_density: z.enum(["high", "medium", "low"]),
  celestial_config: celestialVisualConfigSchema,
  spotify_track_id: z.string().min(1).nullable().optional(),
  spotify_search_query: z.string().min(2),
  personality_reading: z.string().min(1),
});

/** Scored catalog shortlist, present only when a playlist catalog was
 *  supplied (see "SONG SCORING" section in prompts/revealSystemPrompt.ts).
 *  Deliberately validated SEPARATELY from `universeRevealSchema` (see
 *  app/api/analyze/route.ts) so a malformed/missing shortlist doesn't force
 *  a retry of an otherwise-good reveal response — it just falls through to
 *  the catalog fallback pick for that attempt. */
export const songCandidatesSchema = z.array(songCandidateSchema);

export type QuizPayloadParsed = z.infer<typeof quizPayloadSchema>;
export type UniverseRevealParsed = z.infer<typeof universeRevealSchema>;
export type CreatureSpecParsed = z.infer<typeof creatureSpecSchema>;
