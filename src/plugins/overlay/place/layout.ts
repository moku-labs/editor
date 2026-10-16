/**
 * @file overlay plugin — lays the host out: the viewport, the window's size in its mode, and the
 * custom properties `--overlay-top`, `--overlay-side`, `--overlay-w`, `--overlay-h` on the host's
 * inline style. Called on mount, a mode change, a drag end, a viewport or inset change; never per
 * tick.
 */
import type { OverlayState, WindowSize } from "../types";
import { topOf, windowSize } from "./dock";

/**
 * Reads the viewport from the host's window.
 *
 * @param state - Overlay state.
 */
export function readViewport(state: OverlayState): void {
  const view = state.host?.ownerDocument.defaultView;
  if (view === null || view === undefined) return;
  state.viewport = { w: view.innerWidth, h: view.innerHeight };
}

/**
 * The window's box in the current mode.
 *
 * @param state - Overlay state.
 * @returns The size.
 */
export function sizeNow(state: OverlayState): WindowSize {
  return windowSize(state.mode, state.viewport);
}

/**
 * The window's top now.
 *
 * @param state - Overlay state.
 * @returns CSS px.
 */
export function currentTop(state: OverlayState): number {
  return topOf(state.place, sizeNow(state), state.viewport, state.insets);
}

/**
 * Writes the mode, the dock and the window's box onto the host.
 *
 * @param state - Overlay state.
 */
export function layout(state: OverlayState): void {
  const host = state.host;
  if (host === undefined) return;
  host.dataset.mode = state.mode;
  host.dataset.dock = state.place.dock;
  if (state.mode === "hidden") return;

  const size = sizeNow(state);
  const side = state.place.dock === "left" ? state.insets.left : state.insets.right;
  host.style.setProperty("--overlay-top", `${currentTop(state)}px`);
  host.style.setProperty("--overlay-side", `${side}px`);
  host.style.setProperty("--overlay-w", `${size.w}px`);
  host.style.setProperty("--overlay-h", `${size.h}px`);
}
