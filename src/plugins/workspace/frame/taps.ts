/**
 * @file workspace plugin — tap ripples (finding 8). workspace subscribes once to link's taps; while
 * the frame is docked (preview or stage) and Show taps is on, each tap draws a ripple in the frame
 * overlay at the tap point. The overlay is in device px and already carries the box transform, so
 * the tap's page px are used as they are. A 20 px accent ring grows to 36 px and fades in 400 ms;
 * under reduced motion a static dot shows for 300 ms. At most 8 ripples live; the oldest goes
 * first.
 */

import { linkPlugin } from "../../link";
import type { Tap } from "../../registry/protocol";
import type { TapRipple, WorkspaceCtx, WorkspaceState } from "../types";

/**
 * Ripples alive at once; a newer tap removes the oldest.
 */
export const MAX_RIPPLES = 8;

/**
 * How long a ring lives, in ms (the `tap-ripple` keyframes in animations.css run as long).
 */
const RING_MS = 400;

/**
 * How long the reduced-motion dot shows, in ms.
 */
const DOT_MS = 300;

/**
 * The media query of the OS reduced-motion setting.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * True when the OS asks for reduced motion.
 *
 * @returns Whether to draw the static dot.
 * @example
 * ```ts
 * prefersReducedMotion(); // false where matchMedia is missing
 * ```
 */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION).matches ?? false;
}

/**
 * Removes one ripple: its element, its timer and its entry.
 *
 * @param state - Workspace state.
 * @param ripple - The ripple.
 */
function removeRipple(state: WorkspaceState, ripple: TapRipple): void {
  clearTimeout(ripple.timer);
  ripple.element.remove();
  const index = state.taps.indexOf(ripple);
  if (index !== -1) state.taps.splice(index, 1);
}

/**
 * True while a tap may draw: workspace runs, Show taps is on, and the frame is docked (preview or
 * stage).
 *
 * @param state - Workspace state.
 * @returns Whether to draw the ripple.
 */
function isDrawable(state: WorkspaceState): boolean {
  const { box } = state.frame;
  const isDocked = box !== undefined && box.docked !== "hidden";
  return !state.stopped && state.showTaps && isDocked;
}

/**
 * Draws one tap ripple in the overlay while the frame is docked and Show taps is on.
 *
 * @param state - Workspace state.
 * @param tap - The tap in device px (page CSS px of the game document).
 */
export function drawTap(state: WorkspaceState, tap: Tap): void {
  const { overlay } = state.frame;
  if (overlay === undefined || !isDrawable(state)) return;

  // The overlay is in device px already: the tap point is placed as it is.
  const reduced = prefersReducedMotion();
  const element = document.createElement("span");
  element.dataset.tapRipple = reduced ? "dot" : "ring";
  element.style.left = `${tap.x}px`;
  element.style.top = `${tap.y}px`;
  overlay.append(element);

  // The ripple removes itself when its animation ends.
  const ripple: TapRipple = {
    element,
    timer: setTimeout(
      () => {
        removeRipple(state, ripple);
      },
      reduced ? DOT_MS : RING_MS
    )
  };
  state.taps.push(ripple);

  // Past the cap, the oldest ripple goes first.
  const oldest = state.taps.length > MAX_RIPPLES ? state.taps[0] : undefined;
  if (oldest !== undefined) removeRipple(state, oldest);
}

/**
 * Removes every ripple and its timer (Show taps off, onStop).
 *
 * @param state - Workspace state.
 */
export function clearTaps(state: WorkspaceState): void {
  for (const ripple of state.taps.splice(0)) {
    clearTimeout(ripple.timer);
    ripple.element.remove();
  }
}

/**
 * Subscribes to link's taps once (onStart); each tap may draw a ripple.
 *
 * @param ctx - State and require.
 * @returns Unsubscribes.
 */
export function watchTaps(ctx: Pick<WorkspaceCtx, "state" | "require">): () => void {
  return ctx.require(linkPlugin).onTap(tap => {
    drawTap(ctx.state, tap);
  });
}
