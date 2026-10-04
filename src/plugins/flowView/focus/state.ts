/**
 * @file flowView focus module — state factory.
 */
import type { FocusState } from "./types";

/**
 * Creates the focus slice: nothing selected or highlighted, empty Back stack, history closed, no
 * menu.
 *
 * @returns The focus state.
 */
export function createFocusState(): FocusState {
  return {
    selected: undefined,
    edge: undefined,
    highlight: { side: "to", index: -1 },
    back: [],
    pulse: undefined,
    historyOpen: false,
    historySelected: undefined,
    historyHover: undefined,
    frames: new Map(),
    menu: undefined
  };
}
