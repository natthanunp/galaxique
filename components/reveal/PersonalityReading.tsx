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
          ? "rounded-2xl bg-linear-to-t from-background/80 via-background/30 to-transparent p-5"
          : "rounded-xl border border-border/70 bg-card/70 p-5 backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span>
          {language === "th" ? "โทนของคุณ" : "Your vibe"} · {vibeLabel}
        </span>
      </div>
      <p className="text-pretty text-base leading-relaxed wrap-break-word text-foreground/90 sm:text-lg">
        {reading}
      </p>
    </motion.div>
  );
}
