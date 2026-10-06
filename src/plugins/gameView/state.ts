/**
 * @file gameView plugin — state factory and the UI store (notify, subscribe).
 */
import type { GameViewState } from "./types";

/**
 * Default length of a new series in the popover (D3).
 */
const DEFAULT_SERIES_MS = 2000;

/**
 * Default interval of a new series in the popover (D3).
 */
const DEFAULT_INTERVAL_MS = 100;

/**
 * Creates the initial gameView state: Element tab, fit, safe area on, picker off, nothing read,
 * Reference mode off (no press, no marquee), no pick bookmarks, nothing published.
 *
 * @returns A fresh state for one app.
 */
export function createGameViewState(): GameViewState {
  return {
    tab: "element",
    zoom: "fit",
    safeArea: true,
    picker: { on: false, hover: undefined },
    selected: undefined,
    treeHover: undefined,
    sources: {},
    watching: [],
    scene: undefined,
    calibration: undefined,
    manifest: undefined,
    card: undefined,
    series: {
      popover: false,
      durationMs: DEFAULT_SERIES_MS,
      intervalMs: DEFAULT_INTERVAL_MS,
      recording: undefined,
      sheet: undefined
    },
    styles: undefined,
    overlayRoot: undefined,
    listeners: new Set(),
    timers: {},
    disposers: [],
    link: { status: undefined, session: undefined, reloading: false },
    reloads: 0,
    calibrationRead: false,
    lookup: undefined,
    cardHeld: false,
    highlightSeq: 0,
    calibrationRun: {
      revision: 0,
      used: undefined,
      reading: false,
      pending: undefined,
      waiting: false
    },
    found: new Map(),
    blocks: new Map(),
    spawns: new Map(),
    cards: new Map(),
    reference: {
      on: false,
      hover: undefined,
      node: undefined,
      unwatch: undefined,
      press: undefined,
      area: undefined
    },
    bookmarks: [],
    pick: undefined,
    selection: undefined
  };
}

/**
 * Calls every UI listener (a listener may unsubscribe while called).
 *
 * @param state - gameView state.
 */
export function notify(state: GameViewState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Adds a UI listener; returns an idempotent remover.
 *
 * @param state - gameView state.
 * @param fn - The listener.
 * @returns Removes the listener.
 */
export function subscribe(state: GameViewState, fn: () => void): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}
