/**
 * @file flowView focus module — state factory.
 */
import type { FocusState } from "./types";

/**
 * Creates the focus slice: nothing selected, strip and history closed.
 *
 * @example
 * ```ts
 * createFocusState().selected; // undefined
 * ```
 */
export function createFocusState(): FocusState {
  throw new Error("not implemented");
}
