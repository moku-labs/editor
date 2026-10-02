/**
 * @file flowView layout module — state factory.
 */
import type { LayoutState } from "./types";

/**
 * Creates the layout slice: no result, empty cache, empty pins, no engine.
 *
 * @example
 * ```ts
 * createLayoutState().seq; // 0
 * ```
 */
export function createLayoutState(): LayoutState {
  throw new Error("not implemented");
}
