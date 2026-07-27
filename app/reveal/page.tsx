"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";

import { StarfieldBackground } from "@/components/shared/StarfieldBackground";
import { LoadingCosmos } from "@/components/shared/LoadingCosmos";
import { SpotifyPlayer } from "@/components/reveal/SpotifyPlayer";
import { PersonalityReading } from "@/components/reveal/PersonalityReading";
import { ShareButton } from "@/components/reveal/ShareButton";
import { Button } from "@/components/ui/button";
import { useQuizStore } from "@/store/quizStore";
import type { UniverseReveal } from "@/types/universe";
// Three.js needs the DOM — load the canvas client-side only.
const UniverseCanvas = dynamic(
  () => import("@/components/reveal/UniverseCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingCosmos label="Summoning your universe…" />
      </div>
    ),
  },
);

/** Friendly labels for the API enum values shown in the reveal UI. */
function humanizeCelestialType(
  t: UniverseReveal["celestial_type"],
  language: "en" | "th",
): string {
  if (language === "th") {
    switch (t) {
      case "galaxy":
        return "ดาราจักรก้นหอย";
      case "black_hole":
        return "หลุมดำ";
      case "neutron_star":
        return "ดาวนิวตรอน";
    }
  }
  switch (t) {
    case "galaxy":
      return "spiral galaxy";
    case "black_hole":
      return "black hole";
    case "neutron_star":
      return "neutron star";
  }
}

/** Friendly labels for the central-symbol enum values shown in the reveal UI. */
function humanizeSymbol(
  s: NonNullable<UniverseReveal["central_symbol"]>,
  language: "en" | "th",
): string {
  if (language === "th") {
    switch (s) {
      case "star":
        return "ดาวนำทาง";
      case "heart":
        return "หัวใจเรืองแสง";
      case "none":
        return "ไม่มีสัญลักษณ์";
    }
  }
  switch (s) {
    case "star":
      return "guiding star";
    case "heart":
      return "glowing heart";
    case "none":
      return "no symbol";
  }
}

export default function RevealPage() {
  const router = useRouter();
  const reveal = useQuizStore((s) => s.reveal);
  const language = useQuizStore((s) => s.language);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The StarfieldBackground is a separate DOM canvas behind the R3F
  // canvas. We need a ref to it too so the screenshot/video export can
  // composite the starfield as the background — the R3F canvas is
  // transparent over it, so without compositing, exports look like a
  // flat silhouette over a white PNG.
  const starfieldRef = useRef<HTMLCanvasElement | null>(null);
  // Track whether the R3F canvas has finished mounting. ShareButton is
  // disabled until this is true so the user can't click "Start recording"
  // before the dynamic import resolves + R3F's onCreated fires. Without
  // this, getCanvas() returns null and handleShare throws the cryptic
  // "Universe canvas isn't ready yet." error.
  const [canvasReady, setCanvasReady] = useState(false);

  // zustand `persist` rehydrates from localStorage asynchronously. On a
  // hard reload / direct navigation to /reveal, the first render runs
  // before the stored reveal is in memory, so `reveal` is briefly null and
  // the redirect below would kick the user back to "/" even though valid
  // data is sitting in localStorage. Track hydration explicitly and only
  // decide to redirect once we KNOW rehydration is finished.
  // `useQuizStore.persist` is only attached on the client (zustand's persist
  // middleware lives on the store object at runtime, but is missing during
  // the first server render). Treat the server as "not yet hydrated" so we
  // never crash trying to call .hasHydrated() during SSR.
  // zustand `persist` rehydrates from localStorage asynchronously. The state
  // arrives in two phases: (1) `useQuizStore.persist.hasHydrated()` flips
  // to `true`, then (2) the actual `setState(...)` that puts the loaded
  // values into the store runs (which propagates to React on the next
  // tick). If we react to (1) immediately, we observe a brief window
  // where `hasHydrated()=true` but our `reveal` selector still returns
  // null — and would incorrectly redirect the user home. Wait one
  // microtask after hydration completes before deciding to redirect, so
  // any in-flight state propagation from `persist` lands first.
  const [hydrated, setHydrated] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(useQuizStore.persist?.hasHydrated?.()),
  );
  useEffect(() => {
    if (hydrated) return;
    if (typeof window === "undefined" || !useQuizStore.persist) return;
    const unsubFinish = useQuizStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // Edge case: persist might already be mid-rehydration by the time we
    // subscribe (hasHydrated() returned false but onFinishHydration was
    // about to fire) — poll once on the next microtask to catch that race.
    queueMicrotask(() => {
      if (useQuizStore.persist.hasHydrated()) setHydrated(true);
    });
    return unsubFinish;
  }, [hydrated]);

  // If there's no reveal *after* rehydration has fully propagated to
  // React (e.g. user navigated directly to /reveal with nothing in
  // localStorage, or cleared storage), bounce home. Before rehydration
  // we render a quiet loader and don't redirect, so a stored reveal
  // isn't lost to a premature navigation.
  useEffect(() => {
    if (!hydrated) return;
    // Defer one tick so any state propagation triggered by `persist`'s
    // hydration commit lands before we evaluate `reveal`. Without this,
    // the first effect pass can observe hydrated=true with reveal=null
    // even when reveal is about to become truthy on the very next render.
    const handle = setTimeout(() => {
      if (!useQuizStore.getState().reveal) router.replace("/");
    }, 0);
    return () => clearTimeout(handle);
  }, [hydrated, router]);

  // Notify the owner via Telegram once the reveal has actually been shown
  // to the user. Keyed off the resolved Spotify track id (or the reading
  // hash) so a page refresh / direct navigation back to /reveal doesn't
  // re-notify for the same reveal. We don't block on the request — failures
  // are logged but never surfaced to the user.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (notifiedRef.current) return;
    if (!hydrated || !reveal) return;
    if (typeof window === "undefined") return;

    const answers = useQuizStore.getState().answers;
    if (answers.length === 0) return;

    // Stable per-reveal id: the resolved Spotify track id when known,
    // otherwise a hash of the reading so we still de-dupe fallbacks.
    const dedupeKey = reveal.spotify_track_id
      ? `track:${reveal.spotify_track_id}`
      : `reading:${reveal.personality_reading.length}:${reveal.vibe}`;
    const sentKey = "galaxseea:telegram-notified";
    try {
      if (window.sessionStorage.getItem(sentKey) === dedupeKey) return;
    } catch {
      // sessionStorage may be disabled (Safari private mode, sandboxed
      // iframe) — fall through and rely on the in-memory ref to dedupe
      // within this tab.
    }

    notifiedRef.current = true;
    try {
      window.sessionStorage.setItem(sentKey, dedupeKey);
    } catch {
      // ignore — best-effort dedupe
    }

    void fetch("/api/telegram/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, language, reveal }),
      keepalive: true,
    }).catch((err) =>
      console.error("[reveal] Telegram notify failed", err),
    );
  }, [hydrated, reveal, language]);

  if (!hydrated || !reveal) {
    return (
      <main className="safe-area-page relative flex min-h-dvh items-center justify-center">
        <LoadingCosmos />
      </main>
    );
  }

  return (
    <>
      <StarfieldBackground
        onCanvasReady={(c) => {
          starfieldRef.current = c;
        }}
      />
      <main className="safe-area-page relative min-h-dvh px-4 sm:px-6">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 py-2">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/">
              <ArrowLeftIcon className="size-4" />
              {language === "th" ? "หน้าแรก" : "Home"}
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1"
            >
              <Link href="/quiz">
                <SparklesIcon className="size-4" />
                {language === "th" ? "ทำใหม่" : "Retake"}
              </Link>
            </Button>
          </div>
        </header>

        <div className="mx-auto mt-2 grid w-full max-w-6xl min-w-0 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* 3D universe — the R3F canvas is transparent over the page-level
              StarfieldBackground, so we deliberately don't add a border or
              backing fill on the OUTER wrapper (any visible bezel breaks
              the illusion that the universe bleeds into the same starry sky
              the user sees across the rest of the reveal page). Keep the
              corner radius matched to the sibling cards (rounded-xl on
              PersonalityReading and SpotifyPlayer) so the three live in one
              visual family; `overflow-hidden` clips the Bloom postprocess
              to those corners instead of letting it spill into the grid
              gutter.

              A 1px inset ring sits *inside* the rounded clip so all four
              corners of the card read consistently against the page
              background — without it, the rounded edge is only visible
              where the canvas is bright, which makes one side look round
              and the others look flat. The ring is kept on `pointer-events:
              none` and lives below the canvas in the stacking order, so
              it never intercepts orbit drags and the R3F scene still
              fills 100% of the card. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="relative h-[55vh] min-h-90 min-w-0 overflow-hidden rounded-xl ring-1 ring-inset ring-white/10 lg:h-[78vh]"
          >
            <UniverseCanvas
              reveal={reveal as UniverseReveal}
              onCanvasReady={(c) => {
                canvasRef.current = c;
                setCanvasReady(true);
              }}
            />
          </motion.div>

          {/* Reading + song + share */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex min-w-0 flex-col gap-4"
          >
            <PersonalityReading
              reading={reveal.personality_reading}
              vibe={reveal.vibe}
              language={language}
            />
            <SpotifyPlayer
              query={reveal.spotify_search_query}
              trackId={reveal.spotify_track_id}
              language={language}
            />
            <div className="flex flex-wrap items-center gap-3">
              <ShareButton
                getCanvas={() => canvasRef.current}
                getStarfield={() => starfieldRef.current}
                disabled={!canvasReady}
                language={language}
              />
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-card/60 px-3 py-1 backdrop-blur-md">
                  {humanizeCelestialType(reveal.celestial_type, language)}
                </span>
                {reveal.central_symbol !== "none" && (
                  <span className="rounded-full border border-border/70 bg-card/60 px-3 py-1 backdrop-blur-md">
                    {humanizeSymbol(reveal.central_symbol, language)}
                  </span>
                )}
                {reveal.creature && (
                  <span
                    className="rounded-full border border-border/70 bg-card/60 px-3 py-1 backdrop-blur-md"
                    title={`A ${reveal.creature.accent !== "none" ? reveal.creature.accent + " " : ""}${reveal.creature.kind} that ${reveal.creature.motion}s beside you`}
                  >
                    {language === "th" ? "เพื่อนคู่ใจ" : "companion"}{" · "}
                    <span className="text-foreground">
                      {reveal.creature.name ?? reveal.creature.kind}
                    </span>
                  </span>
                )}
                <span
                  className="rounded-full border border-border/70 px-3 py-1 backdrop-blur-md"
                  style={{ color: reveal.primary_color }}
                >
                  {reveal.primary_color}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </>
  );
}
