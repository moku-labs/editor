/**
 * @file stateView plugin — state factory.
 */
import type { StateViewState } from "./types";

/**
 * Creates the initial stateView state: no baseline, note "none", seq 0, empty maps, no
 * subscription yet.
 *
 * @returns A fresh state for one app.
 * @example
 * ```ts
 * createStateViewState().note; // "none"
 * ```
 */
export function createStateViewState(): StateViewState {
  return {
    baseline: undefined,
    last: undefined,
    note: "none",
    seq: 0,
    tainted: undefined,
    graph: undefined,
    session: undefined,
    expanded: new Map(),
    listeners: new Set(),
    stopModel: undefined,
    stopTainted: undefined,
    stopManifest: undefined
  };
}
