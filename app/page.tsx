"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { SparklesIcon, ArrowRightIcon, ExternalLinkIcon } from "lucide-react";

import { StarfieldBackground } from "@/components/shared/StarfieldBackground";
import { LanguageToggle } from "@/components/quiz/LanguageToggle";
import { Button } from "@/components/ui/button";
import { prefetchQuiz } from "@/lib/quizPrefetch";
import { useQuizStore } from "@/store/quizStore";

export default function LandingPage() {
  const language = useQuizStore((s) => s.language);
  const reset = useQuizStore((s) => s.reset);
  const prefetchNextQuiz = () => {
    prefetchQuiz(useQuizStore.getState().seenAngles, language);
  };

  // Head start for mobile taps, which get little benefit from a touchstart
  // prefetch alone (the request often hasn't progressed far by the time the
  // tap navigates). Kick one off as soon as the landing page mounts.
  useEffect(() => {
    prefetchQuiz(useQuizStore.getState().seenAngles, language);
  }, [language]);

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
  };

  return (
    <>
      <StarfieldBackground />
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="absolute right-4 top-4 sm:right-6 sm:top-6"
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
              Beta 2
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
      </main>
    </>
  );
}
