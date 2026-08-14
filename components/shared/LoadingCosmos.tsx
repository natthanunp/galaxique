"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useSyncExternalStore } from "react";

/** Subscribe to a server-rendered "no" / client "yes" toggle so we can
 *  distinguish SSR/first-paint from post-mount. React's official pattern
 *  for "render different markup after hydration" — useSyncExternalStore
 *  returns the server snapshot during SSR and the client snapshot
 *  after mount without tripping the new react-hooks/set-state-in-effect
 *  lint rule (which forbids the equivalent `setMounted(true)` inside a
 *  useEffect). The store is module-local and never re-renders after
 *  the initial hydration flip. */
const emptySubscribe = () => () => undefined;
function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Multi-stage loading story while /api/analyze runs.
 *
 *  The server emits progress milestones (starting → spotify → enrich →
 *  llm → picker → done); this component maps each to a small narrative
 *  beat — a constellation that assembles itself across the 6 s wait,
 *  a stage label that crossfades with a soft blur, an elapsed-time
 *  counter, and a thin progress bar at the bottom.
 *
 *  The visual story:
 *    starting → a single glowing seed, calm breathing
 *    spotify  → a faint halo blooms around the seed ("tuning in")
 *    enrich   → 3 satellite points appear and start to orbit
 *    llm      → 6 satellites, wider arrangement; core pulses faster
 *    picker   → satellites briefly scan left-to-right (the picker sweep)
 *    done     → brightness spike, then route transitions to /reveal
 *
 *  Falls back to a single static label when no stage is supplied (used
 *  by the question-generation loading screen on /quiz). In that case
 *  the elapsed counter and progress bar run from a local timer instead
 *  of SSE-driven values. */
type AnalyzeStage =
  | "starting"
  | "spotify"
  | "enrich"
  | "llm"
  | "picker"
  | "done";

interface LoadingCosmosProps {
  label?: string;
  /** Optional analyze stage driving the rotating message. Ignored when
   *  `label` is also supplied (label wins for non-analyze loading). */
  stage?: AnalyzeStage;
  /** Language for the rotating messages. */
  language?: "en" | "th";
  /** Server-reported elapsed ms since the analyze request started.
   *  When the caller drives this (SSE mode), the component reflects
   *  the real progress. When omitted, a local timer fills in so the
   *  fallback `/quiz` loading screen still gets a live counter. */
  msElapsed?: number;
  /** Approximate total budget for the analyze round-trip, used to scale
   *  the thin progress bar. Defaults to ~6.5 s, the measured median. */
  totalBudgetMs?: number;
  /** Quiz-generation progress (SSE-driven). When set, the component shows
   *  a "planning → writing n/8" story with a deterministic progress bar
   *  instead of the time-based analyze bar. */
  quizStage?: "planning" | "writing";
  /** Questions written so far, 1-based. Only meaningful with `quizStage`. */
  quizCompleted?: number;
  /** Total questions in the batch. Only meaningful with `quizStage`. */
  quizTotal?: number;
  /** Short "AI is thinking about X" phrase from the planner, in the quiz's
   *  language. Shown as a subtle live sub-line during the writing phase. */
  thought?: string;
}

const STAGE_LABELS: Record<AnalyzeStage, { en: string; th: string }> = {
  starting: {
    en: "Reading your answers…",
    th: "กำลังอ่านคำตอบของคุณ…",
  },
  spotify: {
    en: "Crawling Spotify for vibes…",
    th: "กำลังสแกน Spotify หา vibe…",
  },
  enrich: {
    en: "Mapping your inner universe…",
    th: "กำลังถอดรหัสจักรวาลภายในของคุณ…",
  },
  llm: {
    en: "Listening to the cosmos…",
    th: "กำลังฟังเสียงจักรวาล…",
  },
  picker: {
    en: "Finding your universe song…",
    th: "กำลังหาเพลงจักรวาลของคุณ…",
  },
  done: {
    en: "Almost there…",
    th: "เกือบถึงแล้ว…",
  },
};

/** Per-stage visual tuning — drives how the constellation grows. The
 *  numbers are calibrated so a viewer sees the seed in `starting`,
 *  one ring of satellites in `enrich`, a wider arrangement in `llm`,
 *  and a brightness lift in `done`. Each stage also has a small
 *  `motion` field that nudges the animation flavor (faster pulses,
 *  scan arc, etc.) without rewriting the underlying framer-motion
 *  values. */
interface StageVisual {
  /** Number of orbiting satellite dots to draw. */
  satellites: number;
  /** Outer ring radius in rem. */
  radiusRem: number;
  /** Satellite dot size in px. */
  dotSize: number;
  /** Core glow scale multiplier. */
  coreScale: number;
  /** Speed multiplier for the orbit (1 = baseline, 2 = frantic). */
  orbitSpeed: number;
  /** Whether the satellites should briefly scan side-to-side (picker). */
  scanning: boolean;
}

const STAGE_VISUAL: Record<AnalyzeStage, StageVisual> = {
  starting: { satellites: 0, radiusRem: 0, dotSize: 0, coreScale: 0.9, orbitSpeed: 0.6, scanning: false },
  spotify: { satellites: 0, radiusRem: 5, dotSize: 0, coreScale: 1.0, orbitSpeed: 0.7, scanning: false },
  enrich: { satellites: 3, radiusRem: 6, dotSize: 2.5, coreScale: 1.05, orbitSpeed: 0.8, scanning: false },
  llm: { satellites: 6, radiusRem: 7.5, dotSize: 2.5, coreScale: 1.15, orbitSpeed: 1.0, scanning: false },
  picker: { satellites: 6, radiusRem: 7.5, dotSize: 3, coreScale: 1.1, orbitSpeed: 1.6, scanning: true },
  done: { satellites: 6, radiusRem: 7.5, dotSize: 3, coreScale: 1.3, orbitSpeed: 1.2, scanning: false },
};

/** Pre-computed satellite angles so the same 6 dots appear at the same
 *  positions in `enrich` and again (slightly larger) in `llm` — gives
 *  the assembly a continuous feel rather than dots appearing in random
 *  new spots. */
const SATELLITE_ANGLES = [0, 60, 120, 180, 240, 300].map(
  (deg) => (deg * Math.PI) / 180,
);

const DEFAULT_BUDGET_MS = 6500;

export function LoadingCosmos({
  label,
  stage,
  language = "th",
  msElapsed,
  totalBudgetMs = DEFAULT_BUDGET_MS,
  quizStage,
  quizCompleted = 0,
  quizTotal = 0,
  thought,
}: LoadingCosmosProps) {
  // Stage-driven message wins when no explicit label is given. The
  // AnimatePresence key on the motion.p below triggers a tiny crossfade
  // when the stage changes so the copy swap feels intentional rather
  // than abrupt.
  const text = label ?? STAGE_LABELS[stage ?? "starting"][language];
  const key = label ? `label:${label}` : `stage:${stage ?? "starting"}`;
  const visual = STAGE_VISUAL[stage ?? "starting"];
  const quizMode = quizStage !== undefined;

  // `useIsMounted` returns false during SSR + first client render and
  // true after hydration. We use it to gate the time-derived nodes
  // (elapsed counter + progress bar) so server and client agree on the
  // initial markup. The 1-frame jump from 0 → actual elapsed on the
  // client is imperceptible; rendering different text on the server
  // vs. client would trigger a hydration mismatch and force React to
  // re-render the whole subtree client-side.
  const mounted = useIsMounted();

  // Local fallback timer — when msElapsed is not provided (e.g. the
  // question-generation loader on /quiz), we still want the elapsed
  // counter and progress bar to look alive. The interval is cheap; we
  // bail as soon as the component unmounts or the prop starts arriving.
  // Only kicks in after `mounted` so we don't tick on the server.
  const [localElapsed, setLocalElapsed] = useState(0);
  const useLocalTimer = mounted && msElapsed === undefined;
  useEffect(() => {
    if (!useLocalTimer) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      setLocalElapsed(Date.now() - start);
    }, 100);
    return () => window.clearInterval(id);
  }, [useLocalTimer]);
  // `elapsedMs` stays 0 until mounted so SSR and first client render
  // produce the same DOM. After mount, the live value takes over.
  const elapsedMs = mounted ? (msElapsed ?? localElapsed) : 0;
  // Don't pretend the request takes longer than the budget — once we
  // exceed it, the bar saturates and the counter keeps ticking. This
  // matches reality: the picker can occasionally push past the median.
  const progressFraction = quizMode
    ? (quizTotal > 0 ? quizCompleted / quizTotal : 0)
    : Math.max(0, Math.min(1, elapsedMs / totalBudgetMs));

  return (
    <div
      className="flex w-full max-w-xs flex-col items-center justify-center gap-7 py-16"
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <Constellation visual={visual} />

      <div className="flex min-h-12 flex-col items-center gap-2">
        {/* Stage label with soft blur crossfade on stage change. The
            `mode="wait"` keeps the new label from overlapping the
            outgoing one, so each transition reads as one swap rather
            than two stacked labels. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={key}
            className="text-sm text-muted-foreground"
            initial={{ opacity: 0, y: 4, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            {quizMode
              ? quizStage === "planning"
                ? (language === "th" ? "กำลังวางแผนคำถาม…" : "Planning your questions…")
                : (language === "th" ? "กำลังเขียนคำถาม…" : "Writing your questions…")
              : text}
          </motion.p>
        </AnimatePresence>

        {/* The explicit "loading gimmick": a 1-Hz-updating elapsed counter
            so the user sees the wait instrumented in real time. In quiz
            mode the counter becomes a deterministic "n/8" so the user sees
            real work being completed instead of seconds ticking by. */}
        <motion.p
          className="font-mono text-xs tabular-nums text-muted-foreground/60"
          aria-hidden="true"
        >
          {quizMode
            ? `${quizCompleted}/${quizTotal}`
            : `${Math.floor(elapsedMs / 1000)}s`}
        </motion.p>

        {/* Live "AI is thinking about X" beat — the planner's per-question
            scene phrase (quiz mode) or the user's own echoed answer (analyze
            mode), crossfaded in as each writer/beat lands. It's the "AI
            thought" gimmick the user asked for, at zero extra latency. */}
        <AnimatePresence mode="wait" initial={false}>
          {thought ? (
            <motion.p
              key={thought}
              className="text-xs italic text-muted-foreground/70"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              aria-hidden="true"
            >
              {thought}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Thin progress bar. The fill grows with elapsedMs / totalBudgetMs
          and saturates cleanly at 100% so it never looks broken even if
          the picker overshoots. In quiz mode it maps deterministically to
          questions-written / total. */}
      <div
        className="h-0.5 w-32 overflow-hidden rounded-full bg-foreground/10"
        aria-hidden="true"
      >
        <motion.div
          className="h-full bg-linear-to-r from-primary/60 via-primary to-accent"
          style={{ width: `${progressFraction * 100}%` }}
          transition={{ duration: 0.25, ease: "linear" }}
        />
      </div>
    </div>
  );
}

/** The animated centerpiece — a constellation that builds itself
 *  across the analyze stages. Driven entirely by the `visual` prop
 *  from the parent so we never have to compute stage transitions
 *  here. The container is fixed size so the layout doesn't reflow as
 *  satellites appear; new satellites fade in at the appropriate
 *  position rather than sliding from offscreen.
 *
 *  Why split this out? Keeps LoadingCosmos focused on the stage
 *  mapping and copy; the visual layer is purely declarative. */
function Constellation({ visual }: { visual: StageVisual }) {
  const radiusPx = visual.radiusRem * 16;
  const visibleSatellites = SATELLITE_ANGLES.slice(0, visual.satellites);
  return (
    <div className="relative size-32">
      {/* Outer halo — visible from `spotify` onward. Driven by
          coreScale so it gently inflates with the active stage. */}
      <motion.div
        className="absolute inset-0 rounded-full bg-primary/5 blur-xl"
        animate={{ scale: visual.coreScale }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />

      {/* Orbit ring — appears with `spotify` (small) and grows. */}
      {visual.radiusRem > 0 && (
        <motion.div
          className="absolute inset-0 m-auto rounded-full border border-primary/30"
          style={{ width: radiusPx * 2, height: radiusPx * 2 }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      )}

      {/* Inner counter-rotating ring for visual interest during `llm`
          and `picker`. Subtle — sits between the orbit ring and core. */}
      {visual.satellites >= 3 && (
        <motion.div
          className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/30"
          animate={{ rotate: -360 }}
          transition={{
            duration: 4 / visual.orbitSpeed,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}

      {/* The core — breathes fastest during `llm` (the long phase). */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{
          width: 28 * visual.coreScale,
          height: 28 * visual.coreScale,
          boxShadow: "0 0 24px 4px hsl(var(--primary) / 0.6)",
        }}
        animate={{
          scale: [1, 1.25, 1],
          opacity: [0.7, 1, 0.7],
        }}
        transition={{
          duration: 1.6 / Math.max(0.6, visual.orbitSpeed),
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Satellite dots — appear from `enrich` onward. Position is
          fixed per index (so the same dot grows in place rather than
          sliding from the center). The wrapper rotates around the
          core; during `picker` an extra x-sway overlay simulates the
          picker "scanning" the catalog. */}
      {visibleSatellites.map((angle, index) => {
        const x = Math.cos(angle) * radiusPx;
        const y = Math.sin(angle) * radiusPx;
        return (
          <ScanningSatellite
            key={index}
            x={x}
            y={y}
            size={visual.dotSize}
            speed={visual.orbitSpeed}
            scanning={visual.scanning}
            delay={index * 0.08}
          />
        );
      })}
    </div>
  );
}

/** One orbiting satellite — rotates with the parent container and
 *  optionally sways left-to-right to suggest active "scanning" during
 *  the picker phase. Kept as its own component so each satellite's
 *  entrance animation runs independently (slight stagger via `delay`)
 *  rather than all six popping in at once. */
function ScanningSatellite({
  x,
  y,
  size,
  speed,
  scanning,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  speed: number;
  scanning: boolean;
  delay: number;
}) {
  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{
        // Place the satellite at its orbit angle on the circle. The
        // wrapper then rotates around the center so all satellites
        // orbit together.
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
      }}
      animate={{
        // During picker the satellite sways ±18px on its tangent so it
        // looks like it's sweeping the catalog. Outside picker the
        // sway is zero so the orbit stays clean.
        x: scanning ? [-18, 18, -18] : 0,
      }}
      transition={{
        x: scanning
          ? { duration: 1.4 / speed, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.4 },
      }}
    >
      <motion.div
        className="rounded-full bg-accent"
        style={{
          width: size,
          height: size,
          boxShadow: "0 0 8px 2px hsl(var(--accent) / 0.7)",
        }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay, ease: "easeOut" }}
      />
    </motion.div>
  );
}