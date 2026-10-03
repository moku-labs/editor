/**
 * @file flowView layout module — state factory.
 */
import { emptyPins } from "./pins";
import type { LayoutState } from "./types";

/**
 * Creates the layout slice: no result, empty cache, nothing expanded or entered, empty pins, no
 * engine.
 *
 * @returns The layout state.
 * @example
 * ```ts
 * createLayoutState().seq; // 0
 * ```
 */
export function createLayoutState(): LayoutState {
  return {
    result: undefined,
    seq: 0,
    cache: new Map(),
    expanded: new Set(),
    enter: [],
    pins: emptyPins(),
    pinsVersion: undefined,
    pinsReadOnly: false,
    dirty: new Set(),
    saving: undefined,
    engine: undefined
  };
}
