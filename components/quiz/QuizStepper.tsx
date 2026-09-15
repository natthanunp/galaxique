"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { AlertCircleIcon } from "lucide-react";

import { QuestionCard } from "@/components/quiz/QuestionCard";
import { LoadingCosmos } from "@/components/shared/LoadingCosmos";
import { Button } from "@/components/ui/button";
import { streamAnalyze } from "@/lib/analyzeStream";
import { streamQuiz } from "@/lib/quizStream";
import { useMinDwell } from "@/lib/useMinDwell";
import { takePrefetchedQuiz } from "@/lib/quizPrefetch";
import { useQuizStore } from "@/store/quizStore";
import type { AnalyzeStage } from "@/lib/analyzeProgress";
import type { QuizProgressEvent } from "@/lib/quizProgress";

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
  // Live progress from /api/generate-quiz's SSE stream. Null until the
  // first event arrives; the loading screen shows the static fallback label
  // until then.
  const [quizProgress, setQuizProgress] = useState<QuizProgressEvent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Live progress stage from /api/analyze's SSE stream. The throttle
  // (useMinDwell, ~750 ms) prevents the user from seeing two stages
  // flash by in the same animation frame — the server fires Spotify and
  // Enrich so close together on a warm cache that without throttling
  // the Spotify label is wasted. Latest stage wins on collision so the
  // user never sees a stale flash.
  const [analyzeStage, setAnalyzeStageThrottled, resetStage] = useMinDwell<AnalyzeStage>(
    "starting",
    750,
  );
  // The server only sends msElapsed at stage boundaries, so the counter
  // would jump 0 → 5000 in one frame on the LLM-stage arrival. To get
  // a continuously-ticking counter we anchor a (serverElapsed, localArrival)
  // pair on each event and add `Date.now() - localArrival` to it. This
  // keeps the displayed elapsed monotonic without polling the server.
  const [analyzeMsElapsed, setAnalyzeMsElapsed] = useState(0);
  const elapsedAnchorRef = useRef<{ serverMs: number; localArrival: number } | null>(null);
  // Rotating "AI is reading your answer" beat during the analyze wait. Cycles
  // through the user's own answers client-side — zero extra latency, just
  // surfacing the input the model is already chewing on. Index -1 = "reading
  // your answers" intro before the first answer echo.
  const [answerEchoIndex, setAnswerEchoIndex] = useState(-1);
  useEffect(() => {
    if (!submitting) return;
    const id = window.setInterval(() => {
      setAnswerEchoIndex((i) => (i + 1) % (questions.length + 1));
    }, 1600);
    return () => window.clearInterval(id);
  }, [submitting, questions.length]);
  // Tick the counter at 100 ms locally between SSE events so the bar
  // grows visibly during the long LLM phase instead of sitting still
  // for ~5 s. Started/stopped with the submitting flag so we don't
  // tick when the loader is off-screen.
  useEffect(() => {
    if (!submitting) return;
    const id = window.setInterval(() => {
      const anchor = elapsedAnchorRef.current;
      if (!anchor) return;
      setAnalyzeMsElapsed(anchor.serverMs + (Date.now() - anchor.localArrival));
    }, 100);
    return () => window.clearInterval(id);
  }, [submitting]);

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
  const loadQuestions = useCallback((explicitRetry = false) => {
    setFetching(true);
    setFetchError(null);
    setQuizProgress(null);
    const avoidAngles = useQuizStore.getState().seenAngles;
    // Fast path: a landing-page prefetch may already be in flight or done.
    // Consume it directly — instant result, no progress needed.
    const prefetched = takePrefetchedQuiz(avoidAngles, language);
    if (prefetched) {
      return prefetched
        .then((data) => {
          setQuestions(data.questions);
          addSeenAngles(data.pickedAngles ?? []);
          setFetching(false);
        })
        .catch((err: Error) => {
          setFetchError(err.message);
          setFetching(false);
        });
    }
    // Slow path: stream progress from the server so the user sees
    // "planning → writing n/8" instead of a static spinner.
    streamQuiz(
      { avoidAngles, language, explicitRetry },
      {
        onProgress: (event) => setQuizProgress(event),
        onResult: (data) => {
          setQuestions(data.questions);
          addSeenAngles(data.pickedAngles ?? []);
          setFetching(false);
        },
        onError: (message) => {
          setFetchError(message);
          setFetching(false);
        },
      },
    ).catch((err: Error) => {
      setFetchError(err.message);
      setFetching(false);
    });
  }, [setQuestions, addSeenAngles, language]);

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
    void loadQuestions(true);
  }, [reset, loadQuestions]);

  const total = questions.length;
  const currentQuestion = questions[step];
  const storedAnswer = currentQuestion
    ? answers.find((answer) => answer.questionId === currentQuestion.id)?.answer
    : undefined;
  const storedIndex = currentQuestion && storedAnswer
    ? currentQuestion.options.findIndex((option) => option.text === storedAnswer)
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
    const text = currentQuestion.text;
    const canonicalAnswer = effectiveSelectedIndex === currentQuestion.options.length
      ? effectiveCustomAnswer.trim()
      : currentQuestion.options[effectiveSelectedIndex].text;
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
    setAnswerEchoIndex(-1);

    // Build the final answers payload from the store + current selection.
    const finalAnswers = questions.map((q) => {
      const stored = answers.find((a) => a.questionId === q.id);
      const qText = q.text;
      const ans = q.id === currentQuestion.id ? canonicalAnswer : stored?.answer ?? "";
      return { questionId: q.id, questionText: qText, answer: ans };
    });

    const recentTrackIds = useQuizStore.getState().recentTrackIds;
    // Reset to "starting" so a re-submit (e.g. after an error) restarts
    // the stage narrative instead of jumping into "picker" mid-way.
    resetStage("starting");
    setAnalyzeMsElapsed(0);
    elapsedAnchorRef.current = { serverMs: 0, localArrival: Date.now() };
    streamAnalyze(
      { answers: finalAnswers, language, recentTrackIds },
      {
        onProgress: (event) => {
          setAnalyzeStageThrottled(event.stage);
          // Anchor the new server-reported elapsed to the local clock so
          // the local ticker can interpolate until the next event lands.
          elapsedAnchorRef.current = {
            serverMs: event.msElapsed,
            localArrival: Date.now(),
          };
          setAnalyzeMsElapsed(event.msElapsed);
        },
        onResult: (reveal) => {
          // Snap the counter to whatever the last event said before we
          // unmount, so the final reading on /reveal doesn't lag.
          const anchor = elapsedAnchorRef.current;
          if (anchor) {
            setAnalyzeMsElapsed(anchor.serverMs + (Date.now() - anchor.localArrival));
          }
          setReveal(reveal);
          setLoading(false);
          router.push("/reveal");
        },
        onError: (message) => {
          setSubmitError(message);
          setSubmitting(false);
          setLoading(false);
          setError(message);
        },
      },
    );
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
    // Throttled SSE setters — identities are stable across renders
    // (defined inside useMinDwell), so including them is safe and
    // keeps exhaustive-deps honest without needing a suppression.
    setAnalyzeStageThrottled,
    resetStage,
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

  // The "AI is reading your answer" beat for the analyze screen. Cycles
  // through the user's own answers; index 0 is the intro line, indexes
  // 1..n echo each answer. All local — no server round-trip.
  const analyzeThought = useMemo(() => {
    if (!submitting) return undefined;
    const prefix =
      language === "th" ? "กำลังอ่านคำตอบของคุณ…" : "Reading your answers…";
    if (answerEchoIndex <= 0 || answerEchoIndex > questions.length) {
      return prefix;
    }
    const answer = answers[answerEchoIndex - 1]?.answer;
    if (!answer) return prefix;
    const trimmed = answer.length > 48 ? `${answer.slice(0, 48)}…` : answer;
    return language === "th"
      ? `"${trimmed}"`
      : `"${trimmed}"`;
  }, [submitting, answerEchoIndex, questions.length, answers, language]);

  // --- States ---

  if (fetching) {
    return quizProgress ? (
      <LoadingCosmos
        quizStage={quizProgress.stage}
        quizCompleted={quizProgress.completed}
        quizTotal={quizProgress.total}
        thought={quizProgress.thought}
        language={language}
      />
    ) : (
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
        stage={analyzeStage}
        language={language}
        msElapsed={analyzeMsElapsed}
        thought={analyzeThought}
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
