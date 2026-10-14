/* eslint-disable unicorn/no-null -- null is "not known yet" on a new log session */
/**
 * @file collector plugin — the state factory and the factory of one device log's session.
 */
import type { LinkedDevice } from "../hub/types";
import type { CollectorState, LogSession } from "./types";

/**
 * collector's state factory (`createState: createCollectorState`): no log, no device, no adb loop.
 *
 * @returns Empty maps and undefineds.
 */
export function createCollectorState(): CollectorState {
  return {
    sessions: new Map(),
    devices: new Map(),
    adb: undefined,
    outDir: undefined,
    stopped: false
  };
}

/**
 * A new device log session: live, nothing written, its build from the pairing until a header
 * names one.
 *
 * @param fields - Its device, the device's log name, the computer file and the normalized model.
 * @param fields.device - The device, as hub:device reported it.
 * @param fields.log - The device's log name.
 * @param fields.file - The absolute computer file.
 * @param fields.model - The normalized model of the file name and the collector lines.
 * @returns The session.
 */
export function createLogSession(fields: {
  readonly device: LinkedDevice;
  readonly log: string;
  readonly file: string;
  readonly model: string;
}): LogSession {
  const { device, log, file, model } = fields;
  return {
    key: `${device.id}/${log}`,
    device,
    log,
    file,
    handle: undefined,
    queue: Promise.resolve(),
    lines: 0,
    lost: 0,
    failing: false,
    offset: null,
    model,
    build: device.build,
    state: "live",
    digest: null,
    facts: { model: null, backend: null, engine: null, rate: null, thermal: null },
    recent: [],
    emittedAt: 0,
    emitTimer: undefined,
    stopTimedOut: false
  };
}
