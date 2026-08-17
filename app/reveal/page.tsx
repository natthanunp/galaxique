"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowLeftIcon, MessageCircleIcon, SparklesIcon } from "lucide-react";

import { LoadingCosmos } from "@/components/shared/LoadingCosmos";
import { VinylDisc } from "@/components/reveal/VinylDisc";
import { PersonalityReading } from "@/components/reveal/PersonalityReading";
import { ShareButton } from "@/components/reveal/ShareButton";
import { CreatureChat } from "@/components/reveal/CreatureChat";
import { Button } from "@/components/ui/button";
import { useQuizStore } from "@/store/quizStore";
import { humanizeCreatureKind } from "@/lib/creatureKind";
import type { ExportOverlayInfo } from "@/components/reveal/UniverseCanvas";
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
      case "diamond":
        return "เพชรประกาย";
      case "infinity":
        return "วงก้นหอยนิรันดร์";
      case "flame":
        return "เปลวเพลิง";
      case "none":
        return "ไม่มีสัญลักษณ์";
    }
  }
  switch (s) {
    case "star":
      return "guiding star";
    case "heart":
      return "glowing heart";
    case "diamond":
      return "compressed diamond";
    case "infinity":
      return "endless loop";
    case "flame":
      return "burning flame";
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
  // When true, UniverseCanvas boosts its DPR to 2.0 for crisp exports.
  const [exportMode, setExportMode] = useState(false);
  const [exportOverlay, setExportOverlay] = useState<ExportOverlayInfo | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

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

  // In Safari browser mode (not PWA), the top bar is browser chrome that
  // the page can't paint behind — the only thing we control is its color
  // via <meta name="theme-color">. Tint it to the reveal's vibe color so
  // the Safari top bar blends with the universe instead of showing a flat
  // dark bar. PWA/standalone ignores this (it draws edge-to-edge behind
  // the status bar already), so this is a no-op there. Restore the default
  // on unmount so navigating away doesn't leave a stale tint.
  useEffect(() => {
    if (!hydrated || !reveal) return;
    if (typeof window === "undefined") return;

    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) return;
    const previous = meta.content;
    meta.content = reveal.primary_color;
    return () => {
      meta.content = previous;
    };
  }, [hydrated, reveal]);

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
          before the first frame paints.

          `absolute inset-0` (not `fixed`) so the canvas stretches to the
          FULL height of the scrollable page. With `fixed` the canvas only
          covered the viewport, so once the reading pushed the page taller
          than one screen, everything below the fold showed the flat
          near-black page background — the "black bar" at the bottom. */}
      <div className={exportMode
        ? "fixed inset-0 z-0 flex items-center justify-center bg-[#05050a]"
        : "pointer-events-none absolute inset-0 z-0"}
      >
        <div
          className={exportMode ? "shrink-0" : "h-full w-full"}
          style={exportMode
            ? {
                width: "min(100vw, 56.25dvh)",
                height: "min(177.777vw, 100dvh)",
              }
            : undefined}
        >
          <UniverseCanvas
            reveal={reveal as UniverseReveal}
            exportMode={exportMode}
            exportOverlay={exportOverlay}
            onCanvasReady={(c) => {
              canvasRef.current = c;
              setCanvasReady(true);
            }}
          />
        </div>
      </div>

      {/* Floating top bar — Home/Retake buttons, kept above the scene.
          Uses `pointer-events-auto` to capture clicks while the canvas
          layer uses `pointer-events-none` so it doesn't block orbit-drag. */}
      <header className="safe-area-top-4 pointer-events-none absolute inset-x-3 z-20 flex items-center justify-between gap-1.5 sm:inset-x-6 sm:gap-2">
        <div className="pointer-events-auto">
          <Button asChild variant="ghost" size="default" className="gap-1.5 rounded-full bg-card/60 px-3 ring-1 ring-white/10 backdrop-blur-md hover:bg-card/80 sm:px-4">
            <Link href="/" aria-label={language === "th" ? "หน้าแรก" : "Home"}>
              <ArrowLeftIcon className="size-4" />
              <span className="hidden sm:inline">
                {language === "th" ? "หน้าแรก" : "Home"}
              </span>
            </Link>
          </Button>
        </div>
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          {reveal.creature && (
            /* Conic-gradient ring matching the home page's "Talk to your
               companion" treatment so the chat trigger pops on the
               reveal screen too. The conic gradient is a CIRCULAR color
               sweep from the center, so on a wide/short button the sweep
               gets clipped by the rectangle's corners and only the
               middle slice of the ring is visible. We render the
               gradient on a square layer that's 200% the button size
               (so the circle is larger than the rectangle on both axes)
               and centered behind the button. The wrapper's
               `overflow-hidden` clips the circle to the button shape,
               leaving a clean rainbow border that animates a full 360°
               every cycle. The button uses `size="default"` (h-10) to
               match the share/retake buttons in the same row.

               The label is ALWAYS shown (not hidden on mobile) so a
               user landing on the reveal page can immediately tell the
               round pink button is "Chat" with their companion — a
               chat bubble icon alone reads as "comments" or "feedback"
               and gets lost among the other icon-only sibling buttons.
               On wider screens we expand the label to use the
               companion's actual name ("Chat with Lumo") to make the
               AI-companion affordance unmistakable. */
            <span className="relative isolate inline-flex shrink min-w-0 items-stretch overflow-hidden rounded-full p-[1.5px]">
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_2.5s_linear_infinite]"
                style={{
                  background:
                    "conic-gradient(from 0deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e)",
                }}
              />
              <Button
                variant="ghost"
                size="default"
                className="relative z-10 min-w-0 gap-1.5 rounded-full border-0 px-3 text-white hover:brightness-110 sm:px-4"
                style={{ backgroundColor: reveal.primary_color }}
                onClick={() => setChatOpen(true)}
                aria-label={language === "th" ? "คุยกับเพื่อนคู่ใจ" : "Chat with companion"}
              >
                <MessageCircleIcon className="size-4 shrink-0" />
                <span className="truncate">
                  {language === "th"
                    ? `คุยกับ ${reveal.creature.name ?? "เพื่อนคู่ใจ"}`
                    : `Talk to ${reveal.creature.name ?? "your companion"}`}
                </span>
              </Button>
            </span>
          )}
          <ShareButton
            getCanvas={() => canvasRef.current}
            disabled={!canvasReady}
            language={language}
            reading={reveal.personality_reading}
            vibe={reveal.vibe}
            onExportModeChange={(exporting, overlay) => {
              setExportMode(exporting);
              setExportOverlay(exporting ? overlay ?? null : null);
            }}
            /* Icon-only square — the chat button carries the labeled
               "Talk to {creatureName}" affordance (the primary
               companion action), so the share trigger doesn't need
               to repeat it. Renders as a 40x40 round button. We let
               the default `Button` variant provide its own
               `bg-primary` purple fill — overriding it here with
               `bg-card/60` would strip the solid background and
               leave a bare ghost button. We only add the
               rounded-full shape on top of the default styling. */
            hideLabel
            size="default"
            className="size-10 rounded-full"
          />
          <Button
            asChild
            variant="ghost"
            size="default"
            className="gap-1.5 rounded-full bg-card/60 px-3 ring-1 ring-white/10 backdrop-blur-md hover:bg-card/80 sm:px-4"
          >
            <Link href="/quiz" aria-label={language === "th" ? "ทำใหม่" : "Retake"}>
              <SparklesIcon className="size-4" />
              <span className="hidden sm:inline">
                {language === "th" ? "ทำใหม่" : "Retake"}
              </span>
            </Link>
          </Button>
        </div>
      </header>

      {/* Immersive content overlay — the vinyl disc is the hero and sits
          in the visual center of the viewport. The reading + meta strip
          dock to the bottom on mobile and to the right edge on desktop,
          leaving the disc clearly visible as the focal point. The
          container is `pointer-events-none` so the canvas still receives
          orbit-drag; only the children opt back in via
          `pointer-events-auto`. */}
      <div className="pointer-events-none relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl flex-col items-stretch gap-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))] sm:px-6 sm:pt-[max(5.5rem,calc(env(safe-area-inset-top)+4.5rem))] lg:max-w-none lg:px-8 lg:flex-row lg:items-stretch lg:justify-end lg:gap-8 xl:gap-12">
        {/* Vinyl hero — centered over the galaxy on every breakpoint.
            On mobile it occupies a dedicated upper scene region, leaving
            the reading to begin below the track controls instead of
            competing with the focal point. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9 }}
            className="pointer-events-auto absolute left-1/2 top-[50svh] z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center sm:top-[46svh] lg:left-1/2 lg:top-[45%] lg:-translate-x-1/2 lg:-translate-y-1/2"
        >
          <VinylDisc
            query={reveal.spotify_search_query}
            trackId={reveal.spotify_track_id}
            language={language}
            primaryColor={reveal.primary_color}
            size="hero"
            className="lg:scale-110"
          />
        </motion.div>

        {/* Reading + meta strip — right column on desktop, full-width at
            the bottom on mobile. On mobile the text is much smaller and
            the dock has tighter padding so the whole reading fits in
            the lower third of the viewport without pushing the disc
            off-center. Capped max-height + scroll on tiny screens. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
            className="pointer-events-auto relative z-20 mt-[calc(50svh+260px)] flex w-full flex-col gap-3 self-end sm:mt-[calc(46svh+260px)] sm:max-w-xl sm:gap-4 lg:absolute lg:right-8 lg:bottom-10 lg:mt-0 lg:w-[38%] lg:max-w-xl xl:w-[36%]"
        >
          <PersonalityReading
            reading={reveal.personality_reading}
            vibe={reveal.vibe}
            language={language}
            borderless
          />
          <div className="w-full text-xs sm:text-sm lg:text-base">
            <RevealMeta
              reveal={reveal}
              language={language}
            />
          </div>
        </motion.div>
      </div>

      {/* Creature chat — opened from the header trigger above */}
      <CreatureChat
        reveal={reveal as UniverseReveal}
        language={language}
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
      />
    </main>
  );
}

/** Color swatch + readable hex label. Renders a small filled square
 *  using the given color, then the hex in a neutral foreground tone.
 *  The previous v1.5 design colored the hex text with the same color,
 *  which became unreadable whenever the color was dark or low-contrast
 *  against the page background. */
function ColorChip({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block size-3 rounded-sm border border-white/20 shadow-[0_0_4px_rgba(0,0,0,0.4)]"
        style={{ backgroundColor: color }}
      />
      <code className="font-mono text-[0.7rem] tracking-wider text-foreground/70">
        {color.toUpperCase()}
      </code>
    </span>
  );
}

/** The bottom meta strip — celestial type, central symbol, companion,
 *  primary + secondary color chips. Kept as a single row on sm+, wraps
 *  on small screens. */
function RevealMeta({
  reveal,
  language,
}: {
  reveal: UniverseReveal;
  language: "en" | "th";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-xs text-muted-foreground/80 lg:text-sm">
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
              {reveal.creature.name ?? humanizeCreatureKind(reveal.creature.kind, language)}
            </span>
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <ColorChip color={reveal.primary_color} />
      {reveal.secondary_color && reveal.secondary_color !== reveal.primary_color && (
        <>
          <span aria-hidden>·</span>
          <ColorChip color={reveal.secondary_color} />
        </>
      )}
    </div>
  );
}
