/**
 * @file workspace plugin — shows a `popover="manual"` element in the browser top layer while it is
 * open (the R4 rule: every float that can cover the game frame lives in the top layer) and places
 * it under its anchor in the top bar.
 */
import { useLayoutEffect } from "preact/hooks";
import type { WorkspaceState } from "../types";
import type { ElementHolder } from "./store";

/**
 * Gap between the anchor and the popover, in px.
 */
const GAP = 6;

/**
 * Least distance between a popover and the window edge, in px.
 */
const EDGE = 8;

/**
 * The left edge of a popover under its anchor, moved left so it never runs off the window (the
 * Registry popover under the right end of the top bar, any popover in a half-screen window).
 *
 * @param anchorLeft - The anchor's left edge.
 * @param width - The popover width (0 before layout).
 * @returns The left edge to use.
 * @example
 * ```ts
 * clampLeft(1254, 760); // innerWidth 1440 → 672
 * ```
 */
function clampLeft(anchorLeft: number, width: number): number {
  const maxLeft = globalThis.innerWidth - width - EDGE;
  return Math.max(EDGE, Math.min(anchorLeft, maxLeft));
}

/**
 * True while the element is shown in the top layer.
 *
 * @param element - A popover element.
 * @returns Whether it is open (false where `:popover-open` is unknown).
 */
function isPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

/**
 * Shows or hides a popover element in the top layer; with an anchor name it is placed below the
 * element marked `[data-popover-anchor="<anchor>"]` in the shell.
 *
 * @param holder - The popover element.
 * @param open - Whether it should show.
 * @param state - Workspace state (the shell root holds the anchor).
 * @param anchor - The anchor name, undefined to keep the CSS position.
 */
export function usePopover(
  holder: ElementHolder<HTMLElement>,
  open: boolean,
  state: WorkspaceState,
  anchor?: string
): void {
  useLayoutEffect(() => {
    const element = holder.current;
    if (element === undefined || typeof element.showPopover !== "function") return;

    if (!open) {
      if (isPopoverOpen(element)) element.hidePopover();
      return;
    }
    const trigger =
      anchor === undefined
        ? undefined
        : state.dom.root?.querySelector(`[data-popover-anchor="${anchor}"]`);
    if (!isPopoverOpen(element)) element.showPopover();
    if (trigger !== undefined && trigger !== null) {
      const rect = trigger.getBoundingClientRect();
      element.style.top = `${rect.bottom + GAP}px`;
      element.style.left = `${clampLeft(rect.left, element.getBoundingClientRect().width)}px`;
    }
  });
}
