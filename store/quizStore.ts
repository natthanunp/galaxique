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
  /** Private token proving this device created `reveal`; kept out of the reveal payload. */
  revealToken: string | null;
  /** Angle strings the user has been shown across ALL past sessions (not
   *  just the current one), capped and persisted to localStorage. Sent as
   *  `avoidAngles` on every /api/generate-quiz call so a repeat visitor sees
   *  fresh angles before anything repeats, instead of only avoiding
   *  same-session retries. */
  seenAngles: string[];
  /** Spotify track IDs the user has recently received as their universe
   *  song, capped and persisted to localStorage. Sent as `recentTrackIds` on
   *  every /api/analyze call so repeat quizzes don't keep landing on the
   *  same famous tracks (Holocene, Apocalypse, etc.). */
  recentTrackIds: string[];
  /** True while waiting on Gemini (question generation or analysis). */
  loading: boolean;
  /** Human-readable error, surfaced in the UI. */
  error: string | null;

  setLanguage: (lang: Language) => void;
  setQuestions: (questions: QuizQuestion[]) => void;
  setAnswer: (questionId: number, questionText: string, answer: string) => void;
  addSeenAngles: (angles: string[]) => void;
  setReveal: (reveal: UniverseReveal | null, revealToken?: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

/** Cap on the persisted angle history — well above the ~24-entry pool so it
 *  effectively never repeats an angle until the whole pool has been used. */
const MAX_SEEN_ANGLES = 80;

/** Cap on the persisted recent-song history. 20 is enough to break repeat
 *  loops on famous defaults (Holocene, Apocalypse) without making the pool
 *  so large that the user never hears a favorite again. */
const MAX_RECENT_TRACK_IDS = 50;

type PersistedQuizState = Pick<
  QuizState,
  | "language"
  | "questions"
  | "answers"
  | "reveal"
  | "revealToken"
  | "seenAngles"
  | "recentTrackIds"
>;

function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "th";
}

function asStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(-limit);
}

/**
 * Client state is untrusted at the persistence boundary: a browser can hold
 * state from an older app version, an interrupted write, or manually altered
 * localStorage. This release changed both the quiz response shape and its API
 * contract, so keep durable preference/history data only when well-formed and
 * reset in-progress serialized quiz/reveal data to avoid mixing old client
 * state with new code.
 */
function migratePersistedQuizState(state: unknown): PersistedQuizState {
  const persisted = (state ?? {}) as Partial<PersistedQuizState>;
  return {
    language: isLanguage(persisted.language) ? persisted.language : "th",
    questions: [],
    answers: [],
    reveal: null,
    revealToken: null,
    seenAngles: asStringList(persisted.seenAngles, MAX_SEEN_ANGLES),
    recentTrackIds: asStringList(persisted.recentTrackIds, MAX_RECENT_TRACK_IDS),
  };
}

export const useQuizStore = create<QuizState>()(
  persist(
    (set) => ({
      language: "th",
      questions: [],
      answers: [],
      reveal: null,
      revealToken: null,
      seenAngles: [],
      recentTrackIds: [],
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
      setReveal: (reveal, revealToken = null) =>
        set((state) => {
          const trackId = reveal?.spotify_track_id ?? null;
          const recentTrackIds = trackId
            ? Array.from(new Set([...state.recentTrackIds, trackId])).slice(
                -MAX_RECENT_TRACK_IDS,
              )
            : state.recentTrackIds;
          // When a new reveal arrives, clear the creature chat session
          // so the old creature's history doesn't poison the new one.
          if (reveal && typeof window !== "undefined") {
            localStorage.removeItem("galaxique-chat-session");
          }
          return { reveal, revealToken, recentTrackIds };
        }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      reset: () =>
        set({
          questions: [],
          answers: [],
          reveal: null,
          revealToken: null,
          loading: false,
          error: null,
        }),
    }),
    {
      name: "galaxique-quiz",
      version: 1,
      migrate: (persistedState) => migratePersistedQuizState(persistedState),
      // Persist everything except the transient loading flag.
      partialize: (state) => ({
        language: state.language,
        questions: state.questions,
        answers: state.answers,
        reveal: state.reveal,
        revealToken: state.revealToken,
        seenAngles: state.seenAngles,
        recentTrackIds: state.recentTrackIds,
      }),
    },
  ),
);
