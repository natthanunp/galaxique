"use client";

import { useEffect } from "react";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  SparklesIcon,
  SparkleIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  DownloadIcon,
  XIcon,
  Share2Icon,
} from "lucide-react";

import { StarfieldBackground } from "@/components/shared/StarfieldBackground";
import { LanguageToggle } from "@/components/quiz/LanguageToggle";
import { VibeCounter } from "@/components/shared/VibeCounter";
import { Button } from "@/components/ui/button";
import { prefetchQuiz } from "@/lib/quizPrefetch";
import { useQuizStore } from "@/store/quizStore";
import type { VibeStats } from "@/lib/vibeStatsStore";
import { humanizeCreatureKind } from "@/lib/creatureKind";
import dynamic from "next/dynamic";

const CreatureChat = dynamic(
  () => import("@/components/reveal/CreatureChat").then((m) => m.CreatureChat),
  { ssr: false },
);

// 3D creature preview needs the DOM (WebGL canvas) — client-only.
const CreaturePreview = dynamic(
  () => import("@/components/shared/CreaturePreview").then((m) => m.CreaturePreview),
  { ssr: false },
);

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallPromptMode = "none" | "native" | "ios" | "browser";

const INSTALL_PROMPT_DISMISSED_KEY = "galaxique-install-prompt-dismissed-v1";
// Bump on every user-visible release. Surfaced in the top-left eyebrow badge
// so users (and you, in screenshots) can see which build is live. The major
// number is the user-facing release; minor is the "this is the new model
// + new prompt" cut. Keep it short — it sits next to the brand name in a
// small pill.
const APP_VERSION = "v1.7.0";

export default function LandingPage() {
  const language = useQuizStore((s) => s.language);
  const reset = useQuizStore((s) => s.reset);
  const reveal = useQuizStore((s) => s.reveal);
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installPromptMode, setInstallPromptMode] =
    useState<InstallPromptMode>("none");
  const [canInstall, setCanInstall] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showInstallSteps, setShowInstallSteps] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [vibeStats, setVibeStats] = useState<VibeStats | null>(null);

  // Fetch vibe stats for the background color blending.
  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.success) setVibeStats(d.stats); })
      .catch(() => {});
  }, []);

  function dismissInstallPromptForever() {
    try {
      window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "1");
    } catch {
      // Ignore storage failures (private mode / quota), UI still closes.
    }

    setInstallPromptEvent(null);
    setInstallPromptMode("none");
    setCanInstall(false);
    setShowInstallPrompt(false);
    setShowInstallSteps(false);
  }

  const prefetchNextQuiz = () => {
    prefetchQuiz(useQuizStore.getState().seenAngles, language);
  };

  // Head start for mobile taps, which get little benefit from a touchstart
  // prefetch alone (the request often hasn't progressed far by the time the
  // tap navigates). Kick one off as soon as the landing page mounts.
  useEffect(() => {
    prefetchQuiz(useQuizStore.getState().seenAngles, language);
  }, [language]);

  useEffect(() => {
    let wasDismissed = false;
    try {
      wasDismissed =
        window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "1";
    } catch {
      wasDismissed = false;
    }
    if (wasDismissed) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ((navigator as Navigator & { standalone?: boolean }).standalone ?? false);
    if (isStandalone) return;

    const ua = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isSafari =
      /safari/.test(ua) && !/crios|fxios|edgios|chrome|android/.test(ua);

    if (isIos && isSafari) {
      setInstallPromptMode("ios");
      setCanInstall(true);
      setShowInstallPrompt(true);
      return;
    }

    let capturedNativePrompt = false;
    const fallbackTimer = window.setTimeout(() => {
      if (capturedNativePrompt) return;
      setInstallPromptMode("browser");
      setCanInstall(true);
    }, 2500);

    const onBeforeInstallPrompt = (event: Event) => {
      capturedNativePrompt = true;
      window.clearTimeout(fallbackTimer);
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setInstallPromptMode("native");
      setCanInstall(true);
      setShowInstallPrompt(true);
    };

    const onAppInstalled = () => {
      dismissInstallPromptForever();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (installPromptMode !== "native" || !installPromptEvent) {
      setShowInstallPrompt(true);
      return;
    }

    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome !== "accepted") {
      dismissInstallPromptForever();
      return;
    }

    dismissInstallPromptForever();
  }

  const t = {
    eyebrow: language === "th" ? "กาแล็กซิก" : "Galaxique",
    versionLabel: APP_VERSION,
    title:
      language === "th"
        ? "ค้นหาดวงดาวที่เป็นตัวคุณ"
        : "Discover the universe that is you",
    subtitle:
      language === "th"
        ? "ตอบคำถามสั้นๆ ไม่กี่ข้อ แล้วให้จักรวาลส่วนตัวของคุณปรากฏขึ้นมาใน 3 มิติ พร้อมเพลงที่ใช่สำหรับคุณ"
        : "Answer a few short questions and watch your personal universe unfold in 3D, with a song that matches your vibe.",
    tribute:
      language === "th"
        ? "ได้แรงบันดาลใจจากใครบางคนที่ทำให้ผมมองกาแล็กซี่แตกต่างออกไปจากเดิม"
        : "Inspired by someone who makes me see the Galaxy differently.",
    cta: language === "th" ? "เริ่มต้นเดินทาง" : "Begin your journey",
    secondary:
      language === "th"
        ? "ใช้เวลาเพียง 3 นาที · ปรับแต่งโดย AI"
        : "Takes about 3 minutes · AI-personalized",
    credits: language === "th" ? "เครดิตโมเดล 3 มิติ" : "3D model credits",
    installTitle: language === "th" ? "ติดตั้ง Galaxique" : "Install Galaxique",
    installDescriptionNative:
      language === "th"
        ? "เปิดได้เร็วขึ้นและใช้งานแบบแอปเต็มหน้าจอ"
        : "Launch faster and use it like a full-screen app.",
    installDescriptionIos:
      language === "th"
        ? "แตะไอคอนแชร์ แล้วเลือก \"Add to Home Screen\""
        : 'Tap Share, then choose "Add to Home Screen".',
    installDescriptionBrowser:
      language === "th"
        ? "เปิดเมนูเบราว์เซอร์ แล้วเลือก \"Install app\" หรือ \"Add to Home screen\""
        : 'Open your browser menu and choose "Install app" or "Add to Home screen".',
    installCta: language === "th" ? "ติดตั้งตอนนี้" : "Install now",
    installHowTo: language === "th" ? "วิธีติดตั้ง" : "How to install",
    installHideSteps: language === "th" ? "ซ่อนขั้นตอน" : "Hide steps",
    installGotIt: language === "th" ? "เข้าใจแล้ว" : "Got it",
    installDismiss: language === "th" ? "ภายหลัง" : "Later",
    installStepsIos:
      language === "th"
        ? [
            "แตะปุ่มแชร์ของ Safari",
            'เลื่อนลงแล้วเลือก "Add to Home Screen"',
            'แตะ "Add" เพื่อยืนยัน',
          ]
        : [
            "Tap the Share button in Safari.",
            'Scroll and choose "Add to Home Screen".',
            'Tap "Add" to confirm.',
          ],
    installStepsBrowser:
      language === "th"
        ? [
            "เปิดเมนูเบราว์เซอร์ (⋮ / ⋯)",
            'เลือก "Install app" หรือ "Add to Home Screen"',
            'กดยืนยันการติดตั้ง',
          ]
        : [
            "Open the browser menu (⋮ / ⋯).",
            'Choose "Install app" or "Add to Home Screen".',
            "Confirm the installation.",
          ],
  };

  const installDescription =
    installPromptMode === "ios"
      ? t.installDescriptionIos
      : installPromptMode === "browser"
        ? t.installDescriptionBrowser
        : t.installDescriptionNative;

  const installSteps =
    installPromptMode === "ios" ? t.installStepsIos : t.installStepsBrowser;

  return (
    <>
      <StarfieldBackground vibeStats={vibeStats} />
      <main className="relative flex min-h-dvh flex-col items-center px-6 pb-16 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))] text-center sm:pt-[max(5.5rem,calc(env(safe-area-inset-top)+4.5rem))]">
        {/* Top bar: eyebrow badge on the left, language toggle on the right.
            Sits at `safe-area-top-4` so it clears the Dynamic Island / status
            bar on iOS PWA without burying the centered content on short
            viewports. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="safe-area-top-4 absolute inset-x-4 flex items-center justify-between gap-3 sm:inset-x-6"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-5 py-2 text-sm text-muted-foreground">
            <SparklesIcon className="size-4 text-accent" />
            <span>{t.eyebrow}</span>
            <span className="text-[10px] text-muted-foreground/60" aria-label={t.versionLabel}>
              {t.versionLabel}
            </span>
          </div>
          <LanguageToggle />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="flex w-full flex-1 flex-col items-center justify-center gap-6"
        >
          <h1 className="max-w-4xl px-2 py-3 text-4xl font-bold leading-[1.2] tracking-tight text-foreground break-words sm:text-6xl sm:text-7xl sm:leading-[1.15]">
            {t.title}
          </h1>

          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t.subtitle}
          </p>

          <div className="mt-4 flex flex-col items-center gap-3">
            <Button asChild size="lg" className="group">
              <Link
                href="/quiz"
                onPointerEnter={prefetchNextQuiz}
                onFocus={prefetchNextQuiz}
                onTouchStart={prefetchNextQuiz}
                onClick={reset}
              >
                {t.cta}
                <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">{t.secondary}</p>
            {canInstall ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setShowInstallPrompt(true);
                  setShowInstallSteps(false);
                }}
              >
                <DownloadIcon className="size-3.5" />
                {installPromptMode === "native" ? t.installCta : t.installHowTo}
              </Button>
            ) : null}
          </div>

          {/* Returning user: show their companion + quick actions above the
              vibe stats, so it's the first thing a returning visitor sees. */}
          {reveal?.creature && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-8 w-full max-w-md rounded-2xl border border-border/50 bg-card/60 p-5 text-left backdrop-blur-md"
            >
              <div className="flex items-center gap-4 mb-4">
                <CreaturePreview
                  kind={reveal.creature.kind}
                  color={reveal.primary_color}
                  size={88}
                  className="border border-white/20 shadow-lg"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {reveal.creature.name ?? (language === "th" ? "เพื่อนคู่ใจ" : "Your companion")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {language === "th" ? `เป็น${humanizeCreatureKind(reveal.creature.kind, language)}ที่โคจรรอบ${reveal.celestial_type === "galaxy" ? "กาแล็กซี่" : reveal.celestial_type === "black_hole" ? "หลุมดำ" : "ดาวนิวตรอน"}ของคุณ`
                      : `A ${reveal.creature.kind} orbiting your ${reveal.celestial_type.replace("_", " ")}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="default" className="flex-1">
                  <Link href="/reveal">{language === "th" ? "เยี่ยมชมจักรวาล" : "Visit your universe"}</Link>
                </Button>
                {/* Conic-gradient ring spun behind an opaque button — the
                    common "AI feature" rainbow-border treatment. The
                    conic gradient is a CIRCULAR color sweep from the
                    center, so on a wide/short button the sweep gets
                    clipped by the rectangle's corners and only the
                    middle slice of the ring is visible. To make the
                    full color loop show we render the gradient on a
                    square layer that's 200% the button size (so the
                    circle is larger than the rectangle on both axes)
                    and centered behind the button. The wrapper's
                    `overflow-hidden` clips the circle to the button
                    shape, leaving a clean rainbow border that
                    animates a full 360° every cycle. */}
                <span className="relative isolate inline-flex shrink-0 overflow-hidden rounded-md p-[1.5px]">
                  <span
                    className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_2.5s_linear_infinite]"
                    style={{
                      background:
                        "conic-gradient(from 0deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e)",
                    }}
                  />
                  <Button
                    size="sm"
                    className="relative z-10 gap-1.5 border-0 text-white hover:brightness-110"
                    style={{ backgroundColor: reveal.primary_color }}
                    onClick={() => setChatOpen(true)}
                  >
                    <SparkleIcon className="size-4" />
                    {language === "th"
                      ? `คุยกับ${reveal.creature.name ?? "เพื่อนคู่ใจ"}`
                      : `Talk to ${reveal.creature.name ?? "your companion"}`}
                  </Button>
                </span>
              </div>
            </motion.div>
          )}

          <div className={reveal?.creature ? "mt-6 w-full max-w-2xl" : "mt-8 w-full max-w-2xl"}>
            <VibeCounter language={language} />
          </div>

          {/* Subtle tribute — no name used, just a soft line of credit. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.6 }}
            className="mt-12 max-w-md text-[11px] leading-relaxed text-muted-foreground/70"
          >
            {t.tribute}
          </motion.p>
        </motion.div>

        <footer className="absolute inset-x-6 bottom-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70 sm:bottom-6">
          <span>{t.credits}</span>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://sketchfab.com/20174720" target="_blank" rel="noreferrer">
            Spirit: 20174720 <ExternalLinkIcon className="size-2.5" />
          </a>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://sketchfab.com/omabuarts" target="_blank" rel="noreferrer">
            Cat: Omabuarts <ExternalLinkIcon className="size-2.5" />
          </a>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://sketchfab.com/yanix" target="_blank" rel="noreferrer">
            Jellyfish: Yanix <ExternalLinkIcon className="size-2.5" />
          </a>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://sketchfab.com/Tnkii" target="_blank" rel="noreferrer">
            Bird: Tnkii <ExternalLinkIcon className="size-2.5" />
          </a>
        </footer>

        {showInstallPrompt && canInstall ? (
          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="fixed bottom-5 left-4 right-4 z-40 mx-auto max-w-md rounded-2xl border border-accent/30 bg-card/90 p-4 text-left shadow-2xl backdrop-blur-lg"
            aria-label={t.installTitle}
          >
            <button
              type="button"
              onClick={dismissInstallPromptForever}
              aria-label={t.installDismiss}
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>

            <div className="pr-8">
              <p className="text-sm font-semibold text-foreground">{t.installTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {installDescription}
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {installPromptMode === "native" ? (
                <Button type="button" size="sm" onClick={handleInstallClick}>
                  <DownloadIcon className="size-4" />
                  {t.installCta}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowInstallSteps((value) => !value)}
                >
                  <Share2Icon className="size-4" />
                  {showInstallSteps ? t.installHideSteps : t.installHowTo}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={dismissInstallPromptForever}
              >
                {installPromptMode === "native" ? t.installDismiss : t.installGotIt}
              </Button>
            </div>

            {installPromptMode !== "native" && showInstallSteps ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                {installSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
          </motion.aside>
        ) : null}
      </main>

      {/* Creature chat — available on landing page for returning users */}
      {reveal && (
        <CreatureChat reveal={reveal} language={language} isOpen={chatOpen} onOpenChange={setChatOpen} />
      )}
    </>
  );
}
