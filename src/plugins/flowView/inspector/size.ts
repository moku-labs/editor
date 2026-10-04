/**
 * @file flowView inspector module — the size of the Inspector's side panel: its bounds and its
 * default width. The Flow workspace hands them to the SidePanel; the preview zone reads them to
 * know how wide the open drawer is.
 */
import type { InspectorTab } from "./types";

/**
 * The smallest width a drag or a key gives the Inspector, in px.
 */
export const INSPECTOR_MIN_W = 220;

/**
 * The largest width a drag or a key gives the Inspector, in px.
 */
export const INSPECTOR_MAX_W = 560;

/**
 * The Inspector width until the person resizes it, when `--inspector-w` cannot be read.
 */
const INSPECTOR_W = 320;

/**
 * The Inspector width for the Code and Styles tabs, until the person resizes it.
 */
const INSPECTOR_WIDE = 400;

/**
 * The Inspector's default width: the `--inspector-w` token (it follows the window), 400 px for
 * the Code and Styles tabs. The person's own width, once resized, wins over both (SidePanel).
 *
 * @param tab - The tab the Inspector shows.
 * @returns The width in px.
 * @example
 * ```ts
 * inspectorWidth("code"); // 400
 * inspectorWidth("info"); // 240 in the 480 px window (the token), 320 without the token
 * ```
 */
export function inspectorWidth(tab: InspectorTab): number {
  if (tab === "code" || tab === "styles") return INSPECTOR_WIDE;

  const root = globalThis.document?.documentElement;
  const token = root === undefined ? "" : getComputedStyle(root).getPropertyValue("--inspector-w");
  const width = Number.parseFloat(token);
  return Number.isFinite(width) && width > 0 ? width : INSPECTOR_W;
}
