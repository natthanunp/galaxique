"use client";

import { LanguagesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuizStore } from "@/store/quizStore";
import type { Language } from "@/types/universe";

/** EN/TH segmented toggle. Persists the choice to the quiz store. */
export function LanguageToggle({ className }: { className?: string }) {
  const language = useQuizStore((s) => s.language);
  const setLanguage = useQuizStore((s) => s.setLanguage);

  const option = (lang: Language, label: string) => (
    <button
      type="button"
      onClick={() => setLanguage(lang)}
      className={cn(
        "px-3 py-1 text-xs font-medium rounded-md transition-colors",
        language === lang
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={language === lang}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/80 p-1",
        className,
      )}
    >
      <LanguagesIcon className="ml-1 size-3.5 text-muted-foreground" />
      {option("th", "TH")}
      {option("en", "EN")}
    </div>
  );
}
