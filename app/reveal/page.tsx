"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";

import { LoadingCosmos } from "@/components/shared/LoadingCosmos";
import { VinylDisc } from "@/components/reveal/VinylDisc";
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

  // Increment vibe stats counter when reveal is shown (fire-and-forget)
  const statsIncrementedRef = useRef(false);
  useEffect(() => {
    if (statsIncrementedRef.current) return;
    if (!hydrated || !reveal) return;
    if (typeof window === "undefined") return;

    const dedupeKey = `stats:${reveal.vibe}:${reveal.spotify_track_id || reveal.personality_reading.length}`;
    const sentKey = "galaxseea:stats-incremented";
    try {
      if (window.sessionStorage.getItem(sentKey) === dedupeKey) return;
    } catch {
      // sessionStorage may be disabled — fall through
    }

    statsIncrementedRef.current = true;
    try {
      window.sessionStorage.setItem(sentKey, dedupeKey);
    } catch {
      // ignore — best-effort dedupe
    }

    void fetch("/api/stats/increment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vibe: reveal.vibe,
        celestial_type: reveal.celestial_type,
      }),
      keepalive: true,
    }).catch((err) =>
      console.error("[reveal] Stats increment failed", err),
    );
  }, [hydrated, reveal]);

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
    <main className="relative min-h-dvh overflow-hidden bg-background">
      {/* Full-bleed R3F scene — the universe IS the background, no bordered
          card, no ring, no rounded clip. The page background is the deep
          space color so the transparent clear color never flashes white
          before the first frame paints. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <UniverseCanvas
          reveal={reveal as UniverseReveal}
          onCanvasReady={(c) => {
            canvasRef.current = c;
            setCanvasReady(true);
          }}
        />
      </div>

      {/* Floating top bar — Home/Retake buttons, kept above the scene.
          Uses `pointer-events-auto` to capture clicks while the canvas
          layer uses `pointer-events-none` so it doesn't block orbit-drag. */}
      <header className="safe-area-top-4 pointer-events-none absolute inset-x-4 z-20 flex items-center justify-between gap-2 sm:inset-x-6">
        <div className="pointer-events-auto">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/">
              <ArrowLeftIcon className="size-4" />
              {language === "th" ? "หน้าแรก" : "Home"}
            </Link>
          </Button>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <ShareButton
            getCanvas={() => canvasRef.current}
            disabled={!canvasReady}
            language={language}
            reading={reveal.personality_reading}
          />
          <Button
            asChild
            variant="ghost"
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

      {/* Immersive content overlay — vinyl disc + reading + badges float
          on top of the R3F scene. Centered on small screens, distributed
          across the viewport on lg+ so the disc anchors the left and the
          reading + badges the right. The overlay container is
          `pointer-events-none` so the canvas behind still receives
          orbit-drag input; only the children opt back in via
          `pointer-events-auto`. */}
      <div className="pointer-events-none relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center justify-center gap-8 px-4 pb-12 pt-24 sm:px-6 lg:flex-row lg:items-center lg:gap-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9 }}
          className="pointer-events-auto flex shrink-0 flex-col items-center"
        >
          <VinylDisc
            query={reveal.spotify_search_query}
            trackId={reveal.spotify_track_id}
            language={language}
            primaryColor={reveal.primary_color}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="pointer-events-auto flex w-full max-w-md flex-col gap-4 lg:max-w-none lg:flex-1"
        >
          <PersonalityReading
            reading={reveal.personality_reading}
            vibe={reveal.vibe}
            language={language}
            borderless
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground/80">
            <span>{humanizeCelestialType(reveal.celestial_type, language)}</span>
            {reveal.central_symbol !== "none" && (
              <>
                <span aria-hidden>·</span>
                <span>{humanizeSymbol(reveal.central_symbol, language)}</span>
              </>
            )}
            {reveal.creature && (
              <>
                <span aria-hidden>·</span>
                <span
                  title={`A ${reveal.creature.accent !== "none" ? reveal.creature.accent + " " : ""}${reveal.creature.kind} that ${reveal.creature.motion}s beside you`}
                >
                  {language === "th" ? "เพื่อนคู่ใจ" : "companion"}
                  {" · "}
                  <span className="text-foreground/80">
                    {reveal.creature.name ?? reveal.creature.kind}
                  </span>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span style={{ color: reveal.primary_color }}>
              {reveal.primary_color}
            </span>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
