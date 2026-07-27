import { z } from "zod";

/** Zod schemas mirroring the Gemini JSON schemas, used to validate model output
 *  at runtime (Gemini guarantees syntactic JSON, but values still need checking). */

export const quizOptionSchema = z.object({
  text_en: z.string().min(1),
  text_th: z.string().min(1),
});

export const quizQuestionSchema = z.object({
  id: z.number().int().min(1),
  /** The underlying facet-of-identity this question probes, invented by the
   *  LLM itself (see prompts/quizSystemPrompt.ts). Used server-side to track
   *  "seen" angles for future-call variety; stripped before the question is
   *  sent to the client. */
  angle: z.string().min(1),
  text_en: z.string().min(1),
  text_th: z.string().min(1),
  /** Exactly 4 bilingual multiple-choice answer options. */
  options: z.array(quizOptionSchema).length(4),
});

export const quizPayloadSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1),
});

/** Structured result from the dedicated playlist-matching LLM pass. Instead
 *  of forcing a single deterministic pick, the model scores several
 *  candidates it genuinely considered — the server then weight-randomly
 *  samples among near-tied top scores (see pickWeightedCandidate() in
 *  app/api/analyze/route.ts). This gives real variety across repeat/similar
 *  quiz answers without ever excluding a track outright: a single standout
 *  fit still always wins since nothing else lands within the tie margin. */
export const songSelectionSchema = z.object({
  // The selector prompt asks for 2-3 signals, but a model may provide a
  // couple of additional useful signals. Accept those rather than spending
  // multiple slow retries on an otherwise valid catalog selection.
  answer_signals: z.array(z.string().min(1)).min(2).max(6),
  candidates: z
    .array(
      z.object({
        /** Helpful when the model can copy it, but title + artist are the
         *  authoritative selection keys the server resolves to a catalog ID. */
        spotify_track_id: z.string().min(1).optional(),
        name: z.string().min(1),
        artist: z.string().min(1),
        /** 0-100 — how well this specific track fits the derived signals.
         *  Scores must genuinely differentiate; don't hedge with several
         *  near-identical high scores. */
        fit_score: z.number().min(0).max(100),
        match_summary: z.string().min(1),
      }),
    )
    .min(1)
    .max(6),
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
  personality_reading_en: z.string().min(1),
  personality_reading_th: z.string().min(1),
});

export type QuizPayloadParsed = z.infer<typeof quizPayloadSchema>;
export type SongSelectionParsed = z.infer<typeof songSelectionSchema>;
export type UniverseRevealParsed = z.infer<typeof universeRevealSchema>;
export type CreatureSpecParsed = z.infer<typeof creatureSpecSchema>;
