"use client";

import { wrapEffect } from "@react-three/postprocessing";

import { LensingEffect } from "./LensingEffect";

/**
 * React-postprocessing wrapper for LensingEffect, following the same
 * `wrapEffect` pattern the library uses internally for its built-in effects
 * (see @react-three/postprocessing's Bloom.tsx). Feature-flagged behind
 * `celestial_type === "black_hole"` and the live adaptive quality tier in
 * UniverseCanvas.tsx, so it can be tuned/reverted independently of the rest
 * of the postprocessing stack.
 */
export const Lensing = wrapEffect(LensingEffect, { strength: 1, radius: 0.42 });
