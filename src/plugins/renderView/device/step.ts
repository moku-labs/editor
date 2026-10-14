/**
 * @file renderView device strip — prev / next over the spikes of the strip's window and the
 * `n/total` counter (spec 09 § Derivation rules `stepSpike`, `counter`), with perf/protocol's
 * window helpers. The selection is kept by frame number, so it survives a window shift.
 */
import type { PerfWindowView } from "./contract";
import { rowOfFrame, spikeOrdinal, stepSpike } from "./contract";

/**
 * The row of the selected frame in the window.
 *
 * @param window - The strip's window.
 * @param selected - The selected frame; undefined for none.
 * @returns The row; −1 for no selection or a frame that left the window.
 */
export function selectedRow(window: PerfWindowView, selected: number | undefined): number {
  return selected === undefined ? -1 : rowOfFrame(window, selected);
}

/**
 * The frame the next (1) or previous (−1) key selects, wrapping. From no selection (or a frame
 * that left the window) next takes the oldest spike and previous the newest.
 *
 * @param window - The strip's window.
 * @param selected - The selected frame; undefined for none.
 * @param dir - 1 for next, −1 for previous.
 * @returns The frame; undefined when the window has no spike.
 * @example
 * ```ts
 * stepFrom(window, 4845, 1); // 4572: the newest spike wraps to the oldest
 * ```
 */
export function stepFrom(
  window: PerfWindowView,
  selected: number | undefined,
  dir: 1 | -1
): number | undefined {
  const total = window.spikeCount;
  if (total === 0) return undefined;

  const row = selectedRow(window, selected);
  const edge = dir === 1 ? window.spikes[0] : window.spikes[total - 1];
  const spike = row < 0 ? (edge ?? -1) : stepSpike(window, row, dir);
  return spike < 0 ? undefined : window.frame[spike];
}

/**
 * The counter between the keys: "5/6" on a spike, "–/6" when the selection is not a spike (or
 * none), "0/0" without spikes.
 *
 * @param window - The strip's window.
 * @param selected - The selected frame; undefined for none.
 * @returns The text.
 * @example
 * ```ts
 * spikeCounter(window, undefined); // "–/6"
 * ```
 */
export function spikeCounter(window: PerfWindowView, selected: number | undefined): string {
  const total = window.spikeCount;
  if (total === 0) return "0/0";

  const row = selectedRow(window, selected);
  const ordinal = row < 0 ? 0 : spikeOrdinal(window, row);
  return `${ordinal === 0 ? "–" : String(ordinal)}/${total}`;
}
