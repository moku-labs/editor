/* eslint-disable unicorn/no-null -- null is "device mode off" and "no session" in the records */
/**
 * @file connect plugin — the state factory, the runtime seams (Bun.spawn for adb, fetch for
 * `/json/list`, Bun's WebSocket for CDP) and the factory of a telemetry attach record.
 */
import { fetchJson } from "./cdp/attach";
import { openCdpSocket } from "./cdp/client";
import type { AttachRecord, ConnectDeps, ConnectState } from "./types";
import { runAdb } from "./wire/run";

/** The runtime's seams: what the plugin runs with outside the unit tests. */
const RUNTIME_DEPS: ConnectDeps = { run: runAdb, fetchJson, openSocket: openCdpSocket };

/**
 * Creates the initial connect state: device mode off with no owner, adb assumed available until
 * a call says otherwise, no phone, no pairing asking, no lease, no attach, no forward, nothing
 * published, no timer, not stopped.
 *
 * @returns The state.
 */
export function createConnectState(): ConnectState {
  return {
    mode: { on: false, owner: null, listen: null },
    adb: { available: true, reason: undefined },
    wire: new Map(),
    asking: [],
    scanUntil: 0,
    watches: new Map(),
    attaches: new Map(),
    published: undefined,
    publishedAt: 0,
    timers: { scan: undefined, publish: undefined },
    scanning: undefined,
    looping: false,
    modeSince: undefined,
    turning: undefined,
    forwards: new Map(),
    deps: RUNTIME_DEPS,
    stopped: false
  };
}

/**
 * Creates the record of a new telemetry attach: not probed, no counters, memory and CPU warming
 * up, no CDP link yet.
 *
 * @param device - The linked device id.
 * @param serial - Its adb serial.
 * @param page - Its device session's page (the CDP target), null without a session.
 * @returns The record.
 */
export function createAttachRecord(
  device: string,
  serial: string,
  page: string | null
): AttachRecord {
  return {
    device,
    serial,
    page,
    ended: false,
    busy: false,
    probe: undefined,
    missing: new Map(),
    counters: undefined,
    memory: {
      app: { available: false, source: "dumpsys meminfo", reason: "warming-up" },
      renderer: { available: false, source: "dumpsys meminfo", reason: "warming-up" }
    },
    memoryAt: 0,
    cdp: undefined,
    heap: { samples: [], before: undefined, off: "no-devtools-socket", pending: false },
    timers: { tick: undefined, heap: undefined },
    last: undefined
  };
}
