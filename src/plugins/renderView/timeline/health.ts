/**
 * @file renderView timeline — paints the connection bar's health line (spec 09 § M7): 48
 * latency samples scaled to 0…2 × their mean, allocation-free. Typed stub of build wave 0 (spec
 * 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV2) writes the bodies.
 */
import type { SourceHealth } from "../source/contract";
import { notBuilt } from "../stub";
import type { TimelineLayout } from "./layout";
import type { MissionPalette } from "./palette";

/**
 * Paints the latency sparkline.
 *
 * @param _g - The canvas context.
 * @param _layout - The canvas's geometry.
 * @param _health - activeSource.health().
 * @param _palette - The colours.
 * @throws {Error} Until build wave 3: "renderView timeline/paintHealth is not built yet".
 */
export function paintHealth(
  _g: CanvasRenderingContext2D,
  _layout: TimelineLayout,
  _health: SourceHealth,
  _palette: MissionPalette
): void {
  notBuilt("timeline/paintHealth", 3);
}
