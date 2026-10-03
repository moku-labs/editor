/**
 * @file capture plugin — the game page viewport of a shot (pure over an injected window-like object).
 */
import type { Device } from "./types";

/**
 * What readDevice needs of a window: its CSS size, absent outside a browser.
 */
type ViewLike = { readonly innerWidth?: number; readonly innerHeight?: number };

/**
 * CSS size of the viewport and its orientation; headless → zeros, portrait.
 *
 * @param view - A window-like object; globalThis by default.
 * @param view.innerWidth - Viewport width in CSS px.
 * @param view.innerHeight - Viewport height in CSS px.
 * @returns The device: rounded width and height, landscape only when wider than high.
 * @example
 * ```ts
 * readDevice({ innerWidth: 393, innerHeight: 852 }); // { w: 393, h: 852, orientation: "portrait" }
 * ```
 */
export function readDevice(view: ViewLike = globalThis): Device {
  const w = Math.round(view.innerWidth ?? 0);
  const h = Math.round(view.innerHeight ?? 0);

  return { w, h, orientation: w > h ? "landscape" : "portrait" };
}
