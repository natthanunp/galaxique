"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Language,
  QuizAnswer,
  QuizQuestion,
  UniverseReveal,
} from "@/types/universe";

/** Cross-route state: language, generated questions, collected answers, and the
 * final reveal result. Persisted to localStorage so a refresh mid-quiz doesn't
 * lose progress; the reveal result survives so /reveal can re-render. */
interface QuizState {
  language: Language;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  reveal: UniverseReveal | null;
  /** Angle strings the user has been shown across ALL past sessions (not
   *  just the current one), capped and persisted to localStorage. Sent as
   *  `avoidAngles` on every /api/generate-quiz call so a repeat visitor sees
   *  fresh angles before anything repeats, instead of only avoiding
   *  same-session retries. */
  seenAngles: string[];
  /** True while waiting on Gemini (question generation or analysis). */
  loading: boolean;
  /** Human-readable error, surfaced in the UI. */
  error: string | null;

  setLanguage: (lang: Language) => void;
  setQuestions: (questions: QuizQuestion[]) => void;
  setAnswer: (questionId: number, questionText: string, answer: string) => void;
  addSeenAngles: (angles: string[]) => void;
  setReveal: (reveal: UniverseReveal | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

/** Cap on the persisted angle history — well above the ~24-entry pool so it
 *  effectively never repeats an angle until the whole pool has been used. */
const MAX_SEEN_ANGLES = 80;

export const useQuizStore = create<QuizState>()(
  persist(
    (set) => ({
      language: "en",
      questions: [],
      answers: [],
      reveal: null,
      seenAngles: [],
      loading: false,
      error: null,

      setLanguage: (language) => set({ language }),
      setQuestions: (questions) => set({ questions }),
      setAnswer: (questionId, questionText, answer) =>
        set((state) => {
          const others = state.answers.filter(
            (a) => a.questionId !== questionId,
          );
          return {
            answers: [
              ...others,
              { questionId, questionText, answer },
            ].sort((a, b) => a.questionId - b.questionId),
          };
        }),
      addSeenAngles: (angles) =>
        set((state) => {
          const merged = [...state.seenAngles, ...angles];
          const deduped = Array.from(new Set(merged));
          return { seenAngles: deduped.slice(-MAX_SEEN_ANGLES) };
        }),
      setReveal: (reveal) => set({ reveal }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      reset: () =>
        set({
          questions: [],
          answers: [],
          reveal: null,
          loading: false,
          error: null,
        }),
    }),
    {
      name: "galaxique-quiz",
      // Persist everything except the transient loading flag.
      partialize: (state) => ({
        language: state.language,
        questions: state.questions,
        answers: state.answers,
        reveal: state.reveal,
        seenAngles: state.seenAngles,
      }),
    },
  ),
);
