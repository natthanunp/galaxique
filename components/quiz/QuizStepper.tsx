"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { AlertCircleIcon } from "lucide-react";

import { QuestionCard } from "@/components/quiz/QuestionCard";
import { LoadingCosmos } from "@/components/shared/LoadingCosmos";
import { Button } from "@/components/ui/button";
import { useQuizStore } from "@/store/quizStore";
import type { QuizQuestion } from "@/types/universe";

/** Manages the multi-step quiz: fetches questions, collects answers, submits. */
export function QuizStepper() {
  const router = useRouter();
  const language = useQuizStore((s) => s.language);
  const questions = useQuizStore((s) => s.questions);
  const setQuestions = useQuizStore((s) => s.setQuestions);
  const answers = useQuizStore((s) => s.answers);
  const setAnswer = useQuizStore((s) => s.setAnswer);
  const addSeenAngles = useQuizStore((s) => s.addSeenAngles);
  const setReveal = useQuizStore((s) => s.setReveal);
  const setLoading = useQuizStore((s) => s.setLoading);
  const setError = useQuizStore((s) => s.setError);
  const reset = useQuizStore((s) => s.reset);

  const [step, setStep] = useState(0);
  // Selected option index for the current question. Index 4 means the user's
  // own answer in the card's Other field; null means nothing has been picked.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");
  const [fetching, setFetching] = useState(
    () => questions.length === 0 || answers.length === 0,
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch questions on mount. Reuse cached questions ONLY when the user has
  // already started answering (i.e. a mid-quiz refresh). If there are no
  // answers yet — including the case where a previous quiz was completed
  // and the user is back on /quiz — always re-generate so the questions
  // feel different on each visit.
  //
  // `avoidAngles` is read fresh from the store's persisted `seenAngles` on
  // every call (not passed as an argument) — this now includes angles seen
  // across ALL past sessions, not just the current one, so a repeat visitor
  // gets fresh angles before anything repeats. After a successful fetch, the
  // angles the server actually picked (`pickedAngles`) are appended back to
  // that persisted history.
  //
  // IMPORTANT: the mount effect must run AT MOST ONCE per mount. We
  // intentionally do NOT put `questions`/`answers` in its dep array — putting
  // them there causes the effect to re-fire on every `setQuestions()` /
  // `setAnswer()`, which races with the provider's rate limit and produces
  // visible UI flicker. The `didFetchRef` guard below is the real lock.
  //
  // `loadQuestions` is also called directly from the "Try again" button, so
  // retrying after a failed fetch doesn't require a full page reload.
  const didFetchRef = useRef(false);
  const loadQuestions = useCallback(() => {
    setFetching(true);
    setFetchError(null);
    // Unique per attempt: every "Try again" gets a fresh nonce so the
    // server's LLM-call mutex doesn't dedupe it onto the previous call.
    const nonce = crypto.randomUUID();
    const avoidAngles = useQuizStore.getState().seenAngles;
    return fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avoidAngles, nonce }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed (${res.status})`);
        }
        return res.json() as Promise<{
          questions: QuizQuestion[];
          pickedAngles?: string[];
        }>;
      })
      .then((data) => {
        setQuestions(data.questions);
        addSeenAngles(data.pickedAngles ?? []);
        setFetching(false);
      })
      .catch((err: Error) => {
        setFetchError(err.message);
        setFetching(false);
      });
  }, [setQuestions, addSeenAngles]);

  useEffect(() => {
    if (didFetchRef.current) return;
    if (questions.length > 0 && answers.length > 0) {
      return;
    }
    const requestId = window.setTimeout(() => {
      if (didFetchRef.current) return;
      didFetchRef.current = true;
      void loadQuestions();
    }, 0);
    return () => window.clearTimeout(requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetryFetch = useCallback(() => {
    reset();
    void loadQuestions();
  }, [reset, loadQuestions]);

  const total = questions.length;
  const currentQuestion = questions[step];
  const storedAnswer = currentQuestion
    ? answers.find((answer) => answer.questionId === currentQuestion.id)?.answer
    : undefined;
  const storedIndex = currentQuestion && storedAnswer
    ? currentQuestion.options.findIndex((option) => option.text_en === storedAnswer)
    : -1;
  const effectiveSelectedIndex = selectedIndex ?? (
    storedAnswer
      ? storedIndex >= 0 ? storedIndex : currentQuestion?.options.length ?? null
      : null
  );
  const effectiveCustomAnswer = selectedIndex === null && storedIndex === -1
    ? storedAnswer ?? ""
    : customAnswer;

  const handleNext = useCallback(() => {
    if (!currentQuestion || effectiveSelectedIndex === null) return;
    const text = language === "th" ? currentQuestion.text_th : currentQuestion.text_en;
    const canonicalAnswer = effectiveSelectedIndex === currentQuestion.options.length
      ? effectiveCustomAnswer.trim()
      : currentQuestion.options[effectiveSelectedIndex].text_en;
    if (!canonicalAnswer) return;
    setAnswer(currentQuestion.id, text, canonicalAnswer);

    if (step < total - 1) {
      setSelectedIndex(null);
      setCustomAnswer("");
      setStep((s) => s + 1);
      return;
    }

    // Last step → submit all answers for analysis.
    setSubmitting(true);
    setSubmitError(null);
    setLoading(true);

    // Build the final answers payload from the store + current selection.
    const finalAnswers = questions.map((q) => {
      const stored = answers.find((a) => a.questionId === q.id);
      const qText = language === "th" ? q.text_th : q.text_en;
      const ans = q.id === currentQuestion.id ? canonicalAnswer : stored?.answer ?? "";
      return { questionId: q.id, questionText: qText, answer: ans };
    });

    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: finalAnswers, language }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Analysis failed (${res.status})`);
        }
        return res.json();
      })
      .then((reveal) => {
        setReveal(reveal);
        setLoading(false);
        router.push("/reveal");
      })
      .catch((err: Error) => {
        setSubmitError(err.message);
        setSubmitting(false);
        setLoading(false);
        setError(err.message);
      });
  }, [
    currentQuestion,
    effectiveSelectedIndex,
    effectiveCustomAnswer,
    step,
    total,
    language,
    answers,
    questions,
    setAnswer,
    setSubmitting,
    setSubmitError,
    setLoading,
    setReveal,
    setError,
    router,
  ]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setSelectedIndex(null);
      setCustomAnswer("");
      setStep((s) => s - 1);
    }
  }, [step]);

  const canProceed = useMemo(
    () => effectiveSelectedIndex !== null && (
      effectiveSelectedIndex !== currentQuestion?.options.length || effectiveCustomAnswer.trim().length > 0
    ),
    [effectiveSelectedIndex, currentQuestion, effectiveCustomAnswer],
  );

  // --- States ---

  if (fetching) {
    return (
      <LoadingCosmos
        label={language === "th" ? "กำลังเตรียมคำถาม…" : "Preparing your questions…"}
      />
    );
  }

  if (fetchError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <AlertCircleIcon className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {language === "th"
            ? "ไม่สามารถโหลดคำถามได้"
            : "Couldn't load the questions."}
        </p>
        <p className="text-xs opacity-70">{fetchError}</p>
        <Button variant="outline" onClick={handleRetryFetch}>
          {language === "th" ? "ลองใหม่" : "Try again"}
        </Button>
      </div>
    );
  }

  if (submitting) {
    return (
      <LoadingCosmos
        label={
          language === "th"
            ? "กำลังถอดรหัสจักรวาลของคุณ…"
            : "Decoding your universe…"
        }
      />
    );
  }

  if (submitError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <AlertCircleIcon className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {language === "th"
            ? "การวิเคราะห์ล้มเหลว"
            : "The analysis failed."}
        </p>
        <p className="text-xs opacity-70">{submitError}</p>
        <Button variant="outline" onClick={() => setSubmitError(null)}>
          {language === "th" ? "กลับไปตอบคำถาม" : "Back to the quiz"}
        </Button>
      </div>
    );
  }

  if (!currentQuestion) return null;

  return (
    <div className="flex w-full flex-col items-center">
      <AnimatePresence mode="wait">
        <QuestionCard
          key={currentQuestion.id}
          question={currentQuestion}
          index={step}
          total={total}
          language={language}
          value={effectiveSelectedIndex}
          onChange={setSelectedIndex}
          customAnswer={effectiveCustomAnswer}
          onCustomAnswerChange={setCustomAnswer}
          onBack={handleBack}
          onNext={handleNext}
          isLast={step === total - 1}
          canProceed={canProceed}
        />
      </AnimatePresence>
    </div>
  );
}
