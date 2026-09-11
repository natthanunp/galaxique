"use client";

import { motion } from "framer-motion";

import { profileLabel, type ProfileMetadata } from "@/lib/profile";
import { cn } from "@/lib/utils";
import type { Language } from "@/types/universe";

interface PersonalityReadingProps extends ProfileMetadata {
  reading: string;
  vibe: string;
  language: Language;
  className?: string;
  /** When true, render borderless (no card chrome) — used by the immersive
   *  reveal layout where the reading floats as a text overlay above the
   *  galaxy background. Defaults to true (new immersive design). */
  borderless?: boolean;
}

/** Displays the song-aware three-sentence poetic reading with a gentle fade-in. */
export function PersonalityReading({
  reading,
  vibe,
  profile_version,
  theme,
  language,
  className,
  borderless = true,
}: PersonalityReadingProps) {
  const vibeLabel = profileLabel({ vibe, profile_version, theme }, language);
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
            "rounded-2xl bg-linear-to-b from-transparent via-black/35 to-black/75 p-4 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-6 lg:p-8"
          : "cosmic-panel rounded-xl p-5",
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
