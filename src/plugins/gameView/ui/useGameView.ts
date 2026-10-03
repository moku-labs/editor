/**
 * @file gameView plugin — the Preact hooks of the views: `useGameView` re-renders a component on
 * every `notify(state)`; `useTicker` re-renders it every few ms while a clock shows (recording
 * time, "no heartbeat for N s").
 */
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import { subscribe } from "../state";
import type { GameViewState } from "../types";

/**
 * Subscribes the component to gameView state and returns the selected value of this render. It
 * subscribes in a layout effect, which runs when the render commits: a `notify` right after the
 * first render (before the next paint) still re-renders the component.
 *
 * @param state - gameView state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useGameView<T>(state: GameViewState, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => subscribe(state, () => setVersion(version => version + 1)), [state]);
  return select();
}

/**
 * The clock tick while a recording time shows.
 */
export const RECORD_TICK_MS = 100;

/**
 * The clock tick while the stage shows "no heartbeat for N s".
 */
export const SILENT_TICK_MS = 1000;

/**
 * Re-renders the component every `everyMs` while `active` (a timeout chain, no interval).
 *
 * @param active - Whether the clock runs.
 * @param everyMs - The tick.
 */
export function useTicker(active: boolean, everyMs: number): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setTick(count => count + 1), everyMs);
    return () => clearTimeout(timer);
  }, [active, everyMs, tick]);
}
