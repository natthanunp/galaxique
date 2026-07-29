"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { QuizStepper } from "@/components/quiz/QuizStepper";
import { StarfieldBackground } from "@/components/shared/StarfieldBackground";
import { Button } from "@/components/ui/button";
import { useQuizStore } from "@/store/quizStore";

export default function QuizPage() {
  const language = useQuizStore((s) => s.language);
  return (
    <>
      <StarfieldBackground />
      <main className="safe-area-page-lg relative flex min-h-dvh flex-col px-4 sm:px-6">
        <header className="mx-auto flex w-full max-w-2xl items-center py-2">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/">
              <ArrowLeftIcon className="size-4" />
              {language === "th" ? "หน้าแรก" : "Home"}
            </Link>
          </Button>
        </header>

        <div className="flex flex-1 items-center justify-center py-8">
          <QuizStepper />
        </div>
      </main>
    </>
  );
}
