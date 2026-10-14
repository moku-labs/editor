/**
 * @file renderView device strip — the strip's state factory and its reset on a session change.
 */
import { createPerfWindow } from "./contract";
import type { DeviceStripState } from "./types";

/**
 * Rows of the strip's window: the default of perf's `frames`. A wire value with more rows keeps
 * the newest.
 */
export const STRIP_ROWS = 1024;

/**
 * Creates the strip state: no session, an empty window allocated once, More open, the record
 * panel closed.
 *
 * @returns The state.
 */
export function createDeviceStripState(): DeviceStripState {
  return {
    session: undefined,
    second: undefined,
    secondAt: undefined,
    window: createPerfWindow(STRIP_ROWS),
    spikes: [],
    recorder: undefined,
    perf: "absent",
    selected: undefined,
    record: { kind: "closed" },
    more: true,
    dirty: false,
    watches: [],
    reading: undefined,
    stopPaint: undefined
  };
}

/**
 * Forgets the data of the session: the values, the window's rows, the selection and the record
 * (a late record answer is dropped). The watches and More are left as they are.
 *
 * @param strip - The strip state.
 */
export function clearStripData(strip: DeviceStripState): void {
  strip.second = undefined;
  strip.secondAt = undefined;
  strip.window.count = 0;
  strip.window.spikeCount = 0;
  strip.window.version += 1;
  strip.spikes = [];
  strip.recorder = undefined;
  strip.selected = undefined;
  strip.record = { kind: "closed" };
  strip.reading = undefined;
  strip.dirty = true;
}
