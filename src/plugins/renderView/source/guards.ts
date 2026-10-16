/**
 * @file renderView source — the guards of the values Mission control reads (spec 09 § M14): a
 * value of another shape is dropped and warned, never shown. Typed stub of build wave 0 (spec
 * 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type {
  PerfDetailWire,
  PerfEventsWire,
  PerfPassesWire,
  PerfSecond,
  RecorderSource
} from "./contract";

/**
 * Whether a value is a PerfSecond, the Mission control fields (monitor, memory, caps, epoch)
 * checked when present.
 *
 * @param _value - A watched `editor.perf.second` value.
 * @returns True for a PerfSecond.
 * @throws {Error} Until build wave 3: "renderView source/isPerfSecond is not built yet".
 */
export function isPerfSecond(_value: unknown): _value is PerfSecond {
  return notBuilt("source/isPerfSecond", 3);
}

/**
 * Whether a value is a PerfPassesWire.
 *
 * @param _value - A watched `editor.perf.passes` value (null before the agent's first full second).
 * @returns True for a PerfPassesWire.
 * @throws {Error} Until build wave 3: "renderView source/isPassesWire is not built yet".
 */
export function isPassesWire(_value: unknown): _value is PerfPassesWire {
  return notBuilt("source/isPassesWire", 3);
}

/**
 * Whether a value is a PerfDetailWire (its frames validated with readFramesWire).
 *
 * @param _value - An `editor.perf.detail` answer.
 * @returns True for a PerfDetailWire.
 * @throws {Error} Until build wave 3: "renderView source/isDetailWire is not built yet".
 */
export function isDetailWire(_value: unknown): _value is PerfDetailWire {
  return notBuilt("source/isDetailWire", 3);
}

/**
 * Whether a value is a PerfEventsWire.
 *
 * @param _value - An `editor.perf.events` answer.
 * @returns True for a PerfEventsWire.
 * @throws {Error} Until build wave 3: "renderView source/isEventsWire is not built yet".
 */
export function isEventsWire(_value: unknown): _value is PerfEventsWire {
  return notBuilt("source/isEventsWire", 3);
}

/**
 * Whether a value is a RecorderSource (status, startedBy and marks).
 *
 * @param _value - A watched `editor.recorder` value.
 * @returns True for a RecorderSource.
 * @throws {Error} Until build wave 3: "renderView source/isRecorderSource is not built yet".
 */
export function isRecorderSource(_value: unknown): _value is RecorderSource {
  return notBuilt("source/isRecorderSource", 3);
}
