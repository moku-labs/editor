/**
 * @file renderView derive — the Memory card (spec 09 § M9): the heap's source rule (CDP on a
 * wired phone, a trusted performance.memory on the local preview, never a WebView's), process
 * memory beside it never as heap, baselines after GCs, Leak? and the object counters. Pure.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 3 (RV3) writes the bodies.
 */

import type { MissionSeries } from "../series/types";
import type { DeviceTelemetry, PerfSecond } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionView } from "../types";

/** Leak? needs a baseline slope of at least this, MB/min (spec 09 § M12). */
export const LEAK_MB_PER_MIN = 0.5;

/** An object counter growing at least this per minute counts as growing (spec 09 § M12). */
export const OBJECT_GROWTH_PER_MIN = 10;

/**
 * The memory part of MissionView.
 *
 * @param _second - The source's newest second.
 * @param _telemetry - The active device's telemetry.
 * @param _series - The side series (heap, GCs, objects).
 * @returns The view.
 * @throws {Error} Until build wave 3: "renderView derive/memoryView is not built yet".
 */
export function memoryView(
  _second: PerfSecond | undefined,
  _telemetry: DeviceTelemetry | undefined,
  _series: MissionSeries
): MissionView["memory"] {
  return notBuilt("derive/memoryView", 3);
}
