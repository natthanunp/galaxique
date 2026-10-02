/**
 * Creature behavior state machine (pure, time-driven, testable).
 * The renderer maps states to clips and procedural layers; every state change
 * is crossfaded there, so nothing here ever implies a hard cut.
 */

export type Emotion = "neutral" | "happy" | "shy" | "curious" | "sleepy" | "excited";
export type Reaction = Exclude<Emotion, "neutral"> | "dizzy";
export type BehaviorStateName = "sleep" | "idle" | "notice" | "greet" | "talk" | "listen" | "react" | "rest";

export interface Behavior {
  state: BehaviorStateName;
  since: number;
  reaction?: Reaction;
  lastInteraction: number;
  taps: number[];
  dizzyUntil: number;
  reducedMotion: boolean;
}

export type BehaviorEvent =
  | { type: "arrive" }
  | { type: "typing"; active: boolean }
  | { type: "talkStart" }
  | { type: "talkEnd"; emotion: Emotion }
  | { type: "tap" }
  | { type: "longPress" }
  | { type: "pointerNear" }
  | { type: "tick" };

export const DURATIONS = { notice: 1.1, wakeNotice: 1.8, greet: 1.8, react: 1.8, dizzy: 1.6 } as const;
const REST_AFTER = 45;
const DIZZY_TAPS = 3;
const DIZZY_WINDOW = 2;
const DIZZY_COOLDOWN = 8;

export function createBehavior(t: number, quiet: boolean, reducedMotion = false): Behavior {
  return { state: quiet ? "sleep" : "idle", since: t, lastInteraction: t, taps: [], dizzyUntil: 0, reducedMotion };
}

const enter = (b: Behavior, state: BehaviorStateName, t: number, reaction?: Reaction): Behavior =>
  ({ ...b, state, since: t, reaction });

function react(b: Behavior, reaction: Reaction, t: number): Behavior {
  return { ...enter(b, "react", t, reaction), lastInteraction: t };
}

export function step(b: Behavior, event: BehaviorEvent, t: number): Behavior {
  const elapsed = t - b.since;
  switch (event.type) {
    case "arrive":
      return b.state === "sleep" || b.state === "idle" || b.state === "rest"
        ? { ...enter(b, "notice", t), reaction: b.state === "idle" ? undefined : "sleepy", lastInteraction: t }
        : b;
    case "typing":
      if (event.active && (b.state === "idle" || b.state === "rest" || b.state === "listen")) {
        return { ...enter(b, "listen", t), lastInteraction: t };
      }
      return !event.active && b.state === "listen" ? enter(b, "idle", t) : b;
    case "talkStart":
      return { ...enter(b, "talk", t), lastInteraction: t };
    case "talkEnd":
      return event.emotion === "neutral" ? enter(b, "idle", t) : react(b, event.emotion, t);
    case "tap": {
      if (b.state === "greet" || b.state === "notice") return b;
      const taps = [...b.taps.filter((at) => t - at < DIZZY_WINDOW), t];
      const dizzy = !b.reducedMotion && taps.length >= DIZZY_TAPS && t >= b.dizzyUntil;
      if (dizzy) return { ...react(b, "dizzy", t), taps: [], dizzyUntil: t + DIZZY_COOLDOWN };
      return { ...react(b, "happy", t), taps };
    }
    case "longPress":
      return b.state === "greet" || b.state === "notice" ? b : react(b, "shy", t);
    case "pointerNear":
      return b.state === "idle" ? react(b, "curious", t) : { ...b, lastInteraction: t };
    case "tick": {
      if (b.state === "notice" && elapsed >= (b.reaction === "sleepy" ? DURATIONS.wakeNotice : DURATIONS.notice)) {
        return enter(b, "greet", t);
      }
      if (b.state === "greet" && elapsed >= DURATIONS.greet) return enter(b, "idle", t);
      if (b.state === "react" && elapsed >= (b.reaction === "dizzy" ? DURATIONS.dizzy : DURATIONS.react)) return enter(b, "idle", t);
      if (b.state === "idle" && t - b.lastInteraction >= REST_AFTER) return enter(b, "rest", t);
      return b;
    }
  }
}
