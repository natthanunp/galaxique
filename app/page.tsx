"use client";

import { useEffect } from "react";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  SparklesIcon,
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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallPromptMode = "none" | "native" | "ios" | "browser";

const INSTALL_PROMPT_DISMISSED_KEY = "galaxique-install-prompt-dismissed-v1";

export default function LandingPage() {
  const language = useQuizStore((s) => s.language);
  const reset = useQuizStore((s) => s.reset);
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installPromptMode, setInstallPromptMode] =
    useState<InstallPromptMode>("none");
  const [canInstall, setCanInstall] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showInstallSteps, setShowInstallSteps] = useState(false);

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
        ? "แรงบันดาลใจจากใครบางคนที่ทำให้ผมเห็น Galaxy ต่างออกไปจากเดิม"
        : "Inspired by someone who makes me see the Galaxy differently.",
    cta: language === "th" ? "เริ่มต้นเดินทาง" : "Begin your journey",
    secondary:
      language === "th"
        ? "ใช้เวลาเพียง 2 นาที · ปรับแต่งโดย AI"
        : "Takes about 2 minutes · AI-personalized",
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
      <StarfieldBackground />
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="safe-area-top-4 absolute right-4 sm:right-6"
        >
          <LanguageToggle />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-5 py-2 text-sm text-muted-foreground backdrop-blur-md">
            <SparklesIcon className="size-4 text-accent" />
            {t.eyebrow}
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
              Version 1.0
            </span>
          </div>

          <h1 className="max-w-4xl bg-linear-to-br from-foreground via-foreground to-accent bg-clip-text py-3 text-5xl font-bold leading-[1.25] tracking-tight text-transparent sm:text-7xl">
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

          <div className="mt-8 w-full max-w-2xl">
            <VibeCounter language={language} />
          </div>

          {/* Subtle tribute — no name used, just a soft line of credit. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.6 }}
            className="mt-12 max-w-md text-[11px] italic leading-relaxed text-muted-foreground/70"
          >
            {t.tribute}
          </motion.p>
        </motion.div>

        <footer className="absolute inset-x-6 bottom-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70 sm:bottom-6">
          <span>{t.credits}</span>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://sketchfab.com/jummydoodles" target="_blank" rel="noreferrer">
            Spirit: JummyDoodles <ExternalLinkIcon className="size-2.5" />
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
    </>
  );
}
