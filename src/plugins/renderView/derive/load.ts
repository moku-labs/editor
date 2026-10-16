/**
 * @file renderView derive — the Device load card (spec 09 § M9): CPU per process stacked as %
 * of all cores, GPU busy and clock, each value with its source. Pure. Typed stub of build wave
 * 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV3) writes the bodies.
 */
import type { LoadSeries } from "../series/types";
import { notBuilt } from "../stub";

/**
 * The CPU total line at a sample: app + renderer + surfaceflinger as % of all cores (never % of
 * one core).
 *
 * @param _load - The load series.
 * @param _index - A sample's index.
 * @returns The total; null when no process was read.
 * @throws {Error} Until build wave 3: "renderView derive/cpuTotalPct is not built yet".
 */
export function cpuTotalPct(_load: LoadSeries, _index: number): number | null {
  return notBuilt("derive/cpuTotalPct", 3);
}
