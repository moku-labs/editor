/**
 * @file renderView series — the heap and device-load series from a wired phone's telemetry
 * (spec 09 § M11, M2 rule 6): records arrive in computer epoch ms and are placed on the source
 * clock. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 3 (RV1) writes the bodies.
 */
import type { DeviceTelemetry } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionSeries } from "./types";

/**
 * Adds a record's heap samples, inferred GCs and load readings at `at + offset − timeOrigin`;
 * an unavailable reading is a gap (NaN), never 0.
 *
 * @param _series - The side series.
 * @param _record - A telemetry record of the active device.
 * @param _offsetMs - activeSource.clockOffsetMs(): phone epoch − computer epoch; null before two beats.
 * @param _timeOrigin - The page's clock origin (the second's epoch as a number); null before it is known.
 * @returns Whether the record was placed on the time axis (false without an offset: the cards still read it).
 * @throws {Error} Until build wave 3: "renderView series/addTelemetry is not built yet".
 */
export function addTelemetry(
  _series: MissionSeries,
  _record: DeviceTelemetry,
  _offsetMs: number | null,
  _timeOrigin: number | null
): boolean {
  return notBuilt("series/addTelemetry", 3);
}
