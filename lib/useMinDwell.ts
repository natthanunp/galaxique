"use client";

import { useEffect, useRef, useState } from "react";

/** Returns a state setter that holds the latest value for at least
 *  `minDwellMs` before allowing another change through. Useful for
 *  UI stages that the server fires too fast to see — e.g. /api/analyze's
 *  Spotify fetch is module-cached after the first call so the
 *  `spotify` event lands <50 ms after `starting`; without throttling,
 *  the user sees the label jump straight from "Reading your answers…"
 *  to "Mapping your inner universe…" and the Spotify copy is wasted.
 *
 *  Behavior:
 *   - First call sets state immediately.
 *   - Subsequent calls within the dwell window queue the latest value
 *     and apply it when the dwell expires. The queue is "latest wins":
 *     intermediate values are dropped so the user only sees the most
 *     recent stage, never a flash of an old one.
 *   - On unmount, any pending timer is cleared so we don't call
 *     setState on an unmounted component.
 *
 *  Returns the throttled value (state) plus a `reset` function so the
 *  caller can start a fresh dwell window on a new submission. */
export function useMinDwell<T>(
  initial: T,
  minDwellMs: number,
): readonly [T, (next: T) => void, (to: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const lastChangeRef = useRef<number>(0);
  const pendingValueRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingValueRef.current = null;
  };

  const apply = (next: T) => {
    lastChangeRef.current = Date.now();
    pendingValueRef.current = null;
    timerRef.current = null;
    setValue(next);
  };

  const set = (next: T) => {
    const now = Date.now();
    const elapsed = now - lastChangeRef.current;
    if (elapsed >= minDwellMs) {
      // Past the dwell — apply immediately.
      apply(next);
      return;
    }
    // Inside the dwell window. Queue `next` and schedule a flush. If a
    // previous queued value exists, overwrite it so the user only ever
    // sees the most recent stage (not the one we started waiting on).
    pendingValueRef.current = next;
    if (timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        const pending = pendingValueRef.current;
        if (pending !== null) apply(pending);
      }, minDwellMs - elapsed);
    }
  };

  const reset = (to: T) => {
    clearPending();
    lastChangeRef.current = 0;
    setValue(to);
  };

  // Cancel any pending flush on unmount so we don't call setState on a
  // dead component if a user navigates away mid-stage.
  useEffect(() => clearPending, []);

  return [value, set, reset] as const;
}