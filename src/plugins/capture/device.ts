/**
 * @file capture plugin — the game page viewport of a shot (pure over an injected window-like object).
 */
import type { Device } from "./types";

/**
 * CSS size of the viewport and its orientation; headless → zeros, portrait.
 *
 * @param _view - A window-like object; globalThis by default.
 * @param _view.innerWidth - Viewport width in CSS px.
 * @param _view.innerHeight - Viewport height in CSS px.
 * @example
 * ```ts
 * readDevice({ innerWidth: 393, innerHeight: 852 }); // { w: 393, h: 852, orientation: "portrait" }
 * ```
 */
export function readDevice(_view?: {
  readonly innerWidth?: number;
  readonly innerHeight?: number;
}): Device {
  throw new Error("not implemented");
}
