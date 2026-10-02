/**
 * Checked-in feature flags, one per revamp phase. Flip to false to fall back
 * to the previous experience without a code change elsewhere.
 */
export const FLAGS = {
  /** Interactive spiral-galaxy homepage with published planets. */
  galaxyHomepage: true,
  /** Opt-in publishing of a reveal as a visitable world. */
  worldPublishing: true,
  /** /w/[id] landing sequence, creature greeting and visitor chat. */
  planetLanding: true,
  /** Layered ambient soundtrack that crossfades between galaxy, approach and surface. */
  adaptiveSoundtrack: true,
} as const;
