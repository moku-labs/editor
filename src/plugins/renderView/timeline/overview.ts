/**
 * @file renderView timeline — paints the 2-minute overview strip (spec 09 § M8): the buckets
 * and the view's viewport, the outside dimmed. Typed stub of build wave 0 (spec 09 § M17, RV0):
 * the signatures are the contract the other Mission control units build against; build wave 3
 * (RV2) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MissionState } from "../types";
import type { TimelineLayout } from "./layout";
import type { MissionPalette } from "./palette";

/**
 * Paints the 2-minute overview strip.
 *
 * @param _g - The canvas context (transform set to the dpr).
 * @param _layout - The canvas's geometry.
 * @param _mission - Mission control's state (history, series, view, selection, hover).
 * @param _palette - The colours.
 * @param _endMs - The right edge, source clock.
 * @throws {Error} Until build wave 3: "renderView timeline/paintOverview is not built yet".
 */
export function paintOverview(
  _g: CanvasRenderingContext2D,
  _layout: TimelineLayout,
  _mission: MissionState,
  _palette: MissionPalette,
  _endMs: number
): void {
  notBuilt("timeline/paintOverview", 3);
}
