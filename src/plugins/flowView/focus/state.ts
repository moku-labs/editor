/**
 * @file flowView focus module — state factory.
 */
import type { FocusState } from "./types";

/**
 * Creates the focus slice: nothing selected, strip and history closed, no menu.
 *
 * @returns The focus state.
 * @example
 * ```ts
 * createFocusState().selected; // undefined
 * ```
 */
export function createFocusState(): FocusState {
  return {
    selected: undefined,
    edge: undefined,
    strip: false,
    highlight: { side: "to", index: -1 },
    historyOpen: false,
    historySelected: undefined,
    historyHover: undefined,
    frames: new Map(),
    menu: undefined
  };
}
