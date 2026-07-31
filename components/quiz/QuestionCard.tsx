"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRightIcon, ArrowLeftIcon } from "lucide-react";

import type { Language, QuizQuestion } from "@/types/universe";

interface QuestionCardProps {
  question: QuizQuestion;
  index: number;
  total: number;
  language: Language;
  /** Index of the currently-selected option, or null if none selected yet. */
  value: number | null;
  onChange: (index: number) => void;
  customAnswer: string;
  onCustomAnswerChange: (answer: string) => void;
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
  /** Disable Next until an option is selected. */
  canProceed: boolean;
}

/** A single question step with bilingual text, 4 multiple-choice options, and nav buttons. */
export function QuestionCard({
  question,
  index,
  total,
  language,
  value,
  onChange,
  customAnswer,
  onCustomAnswerChange,
  onBack,
  onNext,
  isLast,
  canProceed,
}: QuestionCardProps) {
  const text = question.text;
  const stepLabel = `${index + 1} / ${total}`;
  const pct = ((index + 1) / total) * 100;

  const nextLabel = isLast
    ? language === "th"
      ? "เผยจักรวาลของฉัน"
      : "Reveal my universe"
    : language === "th"
      ? "ถัดไป"
      : "Next";
  const backLabel = language === "th" ? "กลับ" : "Back";
  // Pressing Enter acts like clicking Next (when an option is selected).
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && canProceed) {
        e.preventDefault();
        onNext();
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [canProceed, onNext]);

  // Auto-focus the card when the question changes so Enter key works immediately.
  useEffect(() => {
    cardRef.current?.focus();
  }, [question.id]);

  const otherLabel = language === "th" ? "อื่นๆ" : "Other";
  const otherPlaceholder = language === "th"
    ? "พิมพ์คำตอบของคุณ"
    : "Write your own answer";

  return (
    <motion.div
      ref={cardRef}
      tabIndex={-1}
      initial={{ opacity: 0, x: 60, rotateY: 12 }}
      animate={{ opacity: 1, x: 0, rotateY: 0 }}
      exit={{ opacity: 0, x: -60, rotateY: -12 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full"
      style={{ perspective: 1000 }}
    >
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {stepLabel}
            </span>
            <Progress value={pct} className="max-w-40" />
          </div>

          <h2 className="text-balance text-xl font-semibold leading-snug sm:text-2xl">
            {text}
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {question.options.map((option, i) => {
              const optionText = option.text;
              const selected = value === i;
              return (
                <Button
                  key={i}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  onClick={() => onChange(i)}
                  className="h-auto min-h-14 w-full justify-start whitespace-normal text-left text-sm sm:text-base"
                >
                  {optionText}
                </Button>
              );
            })}
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant={value === question.options.length ? "default" : "outline"}
                onClick={() => onChange(question.options.length)}
                className="h-auto min-h-14 w-full justify-start"
              >
                {otherLabel}
              </Button>
              {value === question.options.length && (
                <Textarea
                  value={customAnswer}
                  onChange={(event) => onCustomAnswerChange(event.target.value)}
                  placeholder={otherPlaceholder}
                  aria-label={otherLabel}
                  maxLength={240}
                  className="mt-3"
                  autoFocus
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={onBack}
              disabled={index === 0}
              className="gap-1"
            >
              <ArrowLeftIcon className="size-4" />
              {backLabel}
            </Button>
            <Button onClick={onNext} disabled={!canProceed} className="gap-1">
              {nextLabel}
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
