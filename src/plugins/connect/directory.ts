/* eslint-disable unicorn/no-null -- null is "none" on the wire */
/**
 * @file connect plugin — the device directory (spec 11 C4): the pure `buildDirectory` (the phones
 * adb lists with their phase and their match to a linked device, the pairings asking without their
 * codes, the linked devices with their open sessions), the current directory of the state and the
 * hub, and its publish as `editor.devices` — only when it changed, at most every 250 ms.
 */
import { hubPlugin } from "../hub";
import type { LinkedDevice } from "../hub/types";
import type { SessionInfo } from "../registry/protocol";
import { freezeDeep, unref } from "./shared";
import type {
  AskRecord,
  ConnectCtx,
  ConnectState,
  DeviceDirectory,
  LinkedEntry,
  PairAsk,
  WireDevice,
  WireRecord
} from "./types";

/** The shortest time between two publishes of the directory, ms. */
export const PUBLISH_EVERY_MS = 250;

/**
 * What the directory is built from: connect's state, the hub's devices and sessions, and the time.
 */
export type DirectoryInput = {
  readonly mode: ConnectState["mode"];
  readonly modeSince: number | undefined;
  readonly adb: ConnectState["adb"];
  readonly wire: Iterable<WireRecord>;
  readonly asking: readonly AskRecord[];
  readonly linked: readonly LinkedDevice[];
  readonly sessions: readonly SessionInfo[];
  readonly now: number;
  readonly answerTimeoutMs: number;
};

/** Online linked adb devices and ready phones, by model. */
type ModelGroups = {
  readonly linked: Map<string, LinkedDevice[]>;
  readonly phones: Map<string, WireRecord[]>;
};

/**
 * Groups items by a key; items without one are left out.
 *
 * @param items - The items.
 * @param keyOf - The key of an item.
 * @returns The groups.
 * @example
 * ```ts
 * groupBy(["a1", "a2", "b1"], item => item[0] ?? null).get("a"); // ["a1", "a2"]
 * ```
 */
function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/**
 * Orders phones by serial, in code-point order ("192.168.1.23:37011" < "R5CX30ABCDE" <
 * "emulator-5554").
 *
 * @param left - A phone.
 * @param right - Another phone.
 * @returns Negative, zero or positive.
 */
function bySerial(left: WireRecord, right: WireRecord): number {
  if (left.serial === right.serial) return 0;
  return left.serial < right.serial ? -1 : 1;
}

/**
 * The phase of a ready phone no linked device matched: ready while device mode is off, then
 * waiting until `answerTimeoutMs` after device mode came on (or after the phone was plugged, when
 * later), then no-agent.
 *
 * @param record - The phone.
 * @param input - The directory input.
 * @returns The phase.
 */
function readyPhase(record: WireRecord, input: DirectoryInput): WireDevice["phase"] {
  if (!input.mode.on) return "ready";
  const since = Math.max(input.modeSince ?? input.now, record.readySince ?? input.now);
  return input.now - since >= input.answerTimeoutMs ? "no-agent" : "waiting";
}

/**
 * One phone as published, with its phase and its match.
 *
 * @param record - The phone.
 * @param input - The directory input.
 * @param groups - Online adb devices and ready phones, by model.
 * @returns The phone.
 */
function phoneOf(record: WireRecord, input: DirectoryInput, groups: ModelGroups): WireDevice {
  const model = record.facts?.model ?? null;
  const base = {
    serial: record.serial,
    state: record.state,
    transport: record.transport,
    model,
    name: record.facts?.name ?? null,
    os: record.facts?.os ?? null,
    device: null
  };
  if (record.state === "unauthorized") return { ...base, phase: "unauthorized" };
  if (record.state !== "device") return { ...base, phase: "offline" };

  const linked = model === null ? [] : (groups.linked.get(model) ?? []);
  const phones = model === null ? [] : (groups.phones.get(model) ?? []);
  const [match] = linked;
  if (match !== undefined && linked.length === 1 && phones.length === 1) {
    return { ...base, phase: "linked", device: match.id };
  }
  if (match !== undefined) return { ...base, phase: "linked", match: "ambiguous" };
  return { ...base, phase: readyPhase(record, input) };
}

/**
 * A pairing as published: everything but the code.
 *
 * @param record - The pairing.
 * @returns The PairAsk.
 */
function pairAskOf(record: AskRecord): PairAsk {
  const { request } = record;
  return {
    ticket: record.ticket,
    model: request.model,
    address: request.address,
    link: request.link,
    engine: request.engine,
    build: request.build,
    since: record.since
  };
}

/**
 * A linked device as published, with its open session.
 *
 * @param device - The hub's device.
 * @param sessions - The open sessions.
 * @returns The LinkedEntry.
 */
function linkedEntryOf(device: LinkedDevice, sessions: readonly SessionInfo[]): LinkedEntry {
  return {
    id: device.id,
    model: device.model,
    link: device.link,
    address: device.address,
    online: device.online,
    engine: device.engine,
    build: device.build,
    latencyMs: device.latencyMs,
    session: sessions.find(session => session.device?.id === device.id)?.id ?? null
  };
}

/**
 * Where a LAN pairing is confirmed: in the page while device mode is connect's, in perf's terminal
 * while it is another's, nowhere while it is off.
 *
 * @param mode - Device mode.
 * @returns The place.
 * @example
 * ```ts
 * confirmInOf({ on: true, owner: "other", listen: null }); // "terminal"
 * ```
 */
function confirmInOf(mode: ConnectState["mode"]): DeviceDirectory["confirmIn"] {
  if (!mode.on) return null;
  return mode.owner === "connect" ? "page" : "terminal";
}

/**
 * Device mode as published.
 *
 * @param mode - Device mode.
 * @returns The directory's mode, the listen copied.
 */
function modeOf(mode: ConnectState["mode"]): DeviceDirectory["mode"] {
  const { listen } = mode;
  return {
    on: mode.on,
    owner: mode.owner,
    listen: listen === null ? null : { port: listen.port, adb: listen.adb, lan: listen.lan }
  };
}

/**
 * Builds the device directory. A ready phone is linked when exactly one online adb device and
 * exactly one ready phone have its model (the collector's rule); several of either make every
 * phone of that model `match: "ambiguous"`, linked to no device.
 *
 * @param input - The state, the hub's devices and sessions, the time.
 * @returns A fresh frozen directory; phones sorted by serial.
 * @example
 * ```ts
 * buildDirectory({ mode: { on: false, owner: null, listen: null }, modeSince: undefined, adb: { available: true, reason: undefined }, wire: [], asking: [], linked: [], sessions: [], now: 5, answerTimeoutMs: 20000 }).confirmIn; // null
 * ```
 */
export function buildDirectory(input: DirectoryInput): DeviceDirectory {
  const records = [...input.wire].toSorted(bySerial);
  const online = input.linked.filter(device => device.online && device.link === "adb");
  const ready = records.filter(record => record.state === "device");
  const groups: ModelGroups = {
    linked: groupBy(online, device => device.model),
    phones: groupBy(ready, record => record.facts?.model ?? null)
  };
  const { adb } = input;

  return freezeDeep({
    v: 1,
    mode: modeOf(input.mode),
    confirmIn: confirmInOf(input.mode),
    adb:
      adb.reason === undefined
        ? { available: adb.available }
        : { available: adb.available, reason: adb.reason },
    wire: records.map(record => phoneOf(record, input, groups)),
    asking: input.asking.map(record => pairAskOf(record)),
    linked: input.linked.map(device => linkedEntryOf(device, input.sessions)),
    at: input.now
  });
}

/**
 * The directory now, from the state and the hub.
 *
 * @param ctx - Domain context of connect.
 * @returns A fresh frozen directory.
 */
export function currentDirectory(ctx: ConnectCtx): DeviceDirectory {
  const { state } = ctx;
  const hub = ctx.require(hubPlugin);
  return buildDirectory({
    mode: state.mode,
    modeSince: state.modeSince,
    adb: state.adb,
    wire: state.wire.values(),
    asking: state.asking,
    linked: hub.devices(),
    sessions: hub.sessions(),
    now: Date.now(),
    answerTimeoutMs: ctx.config.answerTimeoutMs
  });
}

/**
 * Publishes the directory as `editor.devices` when it differs from the last one published (its
 * JSON without `at`), at most every 250 ms: a change within that time is published once, when the
 * time is up, as it is then. Nothing after onStop.
 *
 * @param ctx - Domain context of connect.
 */
export function refreshDirectory(ctx: ConnectCtx): void {
  const { state } = ctx;
  if (state.stopped) return;
  const directory = currentDirectory(ctx);
  const text = JSON.stringify({ ...directory, at: 0 });
  if (text === state.published) return;

  const wait = state.publishedAt + PUBLISH_EVERY_MS - Date.now();
  if (wait > 0) {
    state.timers.publish ??= unref(
      setTimeout(() => {
        state.timers.publish = undefined;
        refreshDirectory(ctx);
      }, wait)
    );
    return;
  }
  state.published = text;
  state.publishedAt = Date.now();
  ctx.require(hubPlugin).publish("devices", directory);
}
