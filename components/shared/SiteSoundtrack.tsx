"use client";

import { usePathname } from "next/navigation";

import { useSoundtrack } from "@/lib/soundtrack";
import { useMediaStore } from "@/store/mediaStore";

function QuizScore() {
  // The reveal page previews a song through the shared audio element; the score steps aside for it.
  const previewPlaying = useMediaStore((s) => s.mode === "spotify" && s.previewAudible);
  useSoundtrack("quiz", previewPlaying);
  return null;
}

/** Scores every page except the galaxy and planet landing, which pick their own scene. */
export function SiteSoundtrack() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/w/")) return null;
  return <QuizScore />;
}
