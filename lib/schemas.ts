import { z } from "zod";
import { THEMES } from "@/lib/profile";

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
  // Optional only for reveals saved before companions were given names.
  name: z.string().trim().min(1).max(20).optional(),
});

/** New reveal generations must always give their companion a real name. */
export const generatedCreatureSpecSchema = creatureSpecSchema.extend({
  name: z.string().trim().min(1).max(20),
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
  profile_version: z.literal(2).optional(),
  theme: z.enum(THEMES).optional(),
  reveal_id: z.string().uuid().optional(),
  vibe: z.enum(["cute", "cozy", "mysterious", "intense", "whimsical", "cynical"]),
  celestial_type: z.enum([
    "galaxy",
    "black_hole",
    "neutron_star",
  ]),
  central_symbol: z.enum([
    "star",
    "heart",
    "diamond",
    "infinity",
    "flame",
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
