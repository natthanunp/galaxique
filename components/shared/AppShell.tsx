"use client";

import { ReactNode } from "react";

import { BackgroundAudio } from "@/components/shared/BackgroundAudio";

/**
 * Site-wide shell that lives for the whole SPA session.
 * Mounting <BackgroundAudio /> here (instead of inside each page) keeps the
 * <audio> element alive across client-side navigations, so the music never
 * restarts or cuts off when the user moves between /, /quiz, and /reveal.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <BackgroundAudio />
      {children}
    </>
  );
}
