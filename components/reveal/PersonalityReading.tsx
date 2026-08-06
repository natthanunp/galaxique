"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { Language } from "@/types/universe";

interface PersonalityReadingProps {
  reading: string;
  vibe: string;
  language: Language;
  className?: string;
  /** When true, render borderless (no card chrome) — used by the immersive
   *  reveal layout where the reading floats as a text overlay above the
   *  galaxy background. Defaults to true (new immersive design). */
  borderless?: boolean;
}

/** Thai translations for the LLM's `vibe` enum values, shown in the
 *  "Your vibe · {vibe}" label. The enum itself stays English at the data
 *  layer (schema/prompt); only the display label is localized here. */
const VIBE_TH: Record<string, string> = {
  cute: "น่ารัก",
  cozy: "อบอุ่น",
  mysterious: "ลึกลับ",
  intense: "เข้มข้น",
  whimsical: "เพ้อฝัน",
  cynical: "เย็นชา",
};

/** Displays the song-aware three-sentence poetic reading with a gentle fade-in. */
export function PersonalityReading({
  reading,
  vibe,
  language,
  className,
  borderless = true,
}: PersonalityReadingProps) {
  const vibeLabel = language === "th" ? (VIBE_TH[vibe] ?? vibe) : vibe;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className={cn(
        borderless
          ? // The scrim is intentionally softer than v1.5's: just enough
            //  to keep the body text legible above a vibrant galaxy
            //  without forming a hard rectangular block that visually
            //  covers the central scene. The reading also sits in its
            //  own docked column (see app/reveal/page.tsx) so the
            //  galaxy is allowed to occupy the upper half of the
            // viewport on every breakpoint. On mobile we tighten the
            // padding so the reading doesn't push the rest of the UI
            // off the fold.
            "rounded-2xl bg-linear-to-t from-background/75 via-background/20 to-transparent p-4 backdrop-blur-[2px] sm:p-6 lg:p-8"
          : "rounded-xl border border-border/70 bg-card/70 p-5 backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span>
          {language === "th" ? "โทนของคุณ" : "Your vibe"} · {vibeLabel}
        </span>
      </div>
      <p
        lang={language}
        className="text-pretty text-sm leading-relaxed text-foreground/90 sm:text-base md:text-lg lg:text-[1.0625rem] lg:leading-relaxed"
        style={{ wordBreak: "normal", overflowWrap: "normal", lineBreak: "loose" }}
      >
        {reading}
      </p>
    </motion.div>
  );
}
