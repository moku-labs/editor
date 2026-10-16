/**
 * @file renderView timeline — paints one sparkline of a card on the shared axis (spec 09 § M9),
 * allocation-free. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 3 (RV2) writes the bodies.
 */
import type { SeriesColumn } from "../series/types";
import { notBuilt } from "../stub";
import type { TimelineLayout } from "./layout";
import type { MissionPalette } from "./palette";

/** Columns of a sparkline (spec 09 § M12). */
export const SPARK_COLUMNS = 160;

/**
 * Paints a series between two times; a gap (NaN) is a gap, never a ramp to 0.
 *
 * @param _g - The canvas context.
 * @param _layout - The canvas's geometry.
 * @param _column - The series.
 * @param _palette - The colours.
 * @param _startMs - The view's start, source clock.
 * @param _endMs - The view's end, source clock.
 * @throws {Error} Until build wave 3: "renderView timeline/paintSpark is not built yet".
 */
export function paintSpark(
  _g: CanvasRenderingContext2D,
  _layout: TimelineLayout,
  _column: SeriesColumn,
  _palette: MissionPalette,
  _startMs: number,
  _endMs: number
): void {
  notBuilt("timeline/paintSpark", 3);
}
