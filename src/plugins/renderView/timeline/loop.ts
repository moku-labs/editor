/**
 * @file renderView timeline — the requestAnimationFrame loop of the mounted instrument (spec 09
 * § M11): paints the timeline, lane, overview, sparklines and health line only while Render is
 * shown and the tab visible, idles when nothing changed, sizes canvases from a ResizeObserver.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { RenderViewCtx } from "../types";

/**
 * Starts the loop over the instrument's canvases.
 *
 * @param _ctx - Domain context of renderView.
 * @param _root - The instrument's root (its canvases inside).
 * @returns Stops it (the effect cleanup).
 * @throws {Error} Until build wave 4: "renderView timeline/startLoop is not built yet".
 */
export function startLoop(_ctx: RenderViewCtx, _root: HTMLElement): () => void {
  return notBuilt("timeline/startLoop", 4);
}
