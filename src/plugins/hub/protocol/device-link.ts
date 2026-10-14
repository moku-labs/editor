/**
 * @file Device-link wire module (hub/protocol, runtime-free): the types, constants and helpers of a
 * phone's link to the editor server — pairing, the device's perf log batches, the computer's engine
 * fingerprint, the device of a session and the bridge's link state. It imports nothing: it declares
 * its own `LinkJson`, so the only edge between the protocol modules is registry/protocol → here,
 * type-only. The agent's bridge and overlay import `../hub/protocol`, never the hub plugin.
 */

/** The message of a skeleton function that unit 01 implements in wave 1. */
const NOT_IMPLEMENTED = "not implemented";

/**
 * A JSON value on the device link: the same set of values as registry/protocol's `Json`, declared
 * here so hub/protocol imports nothing (no registry/protocol ↔ hub/protocol cycle). The two are
 * assignable both ways.
 *
 * @example
 * ```ts
 * const line: LinkJson = { v: 1, kind: "mark", t: 5917.4, label: "boss", auto: false };
 * ```
 */
export type LinkJson = null | boolean | number | string | LinkJson[] | { [key: string]: LinkJson };

/**
 * How a device reached the hub: through adb reverse on 127.0.0.1, or over the LAN.
 *
 * @example
 * ```ts
 * const link: DeviceLinkKind = "adb";
 * ```
 */
export type DeviceLinkKind = "adb" | "lan";

/**
 * The WebSocket close code of a device upgrade whose device id or token the hub does not know: the
 * socket is upgraded and closed at once, and the phone pairs again.
 */
export const DEVICE_UNPAIRED_CODE = 4401;

/**
 * The WebSocket close reason that goes with `DEVICE_UNPAIRED_CODE`.
 */
export const DEVICE_UNPAIRED_REASON = "unpaired";

/**
 * Params of the device→hub editor-channel notification `pair`: the code the phone shows, and what
 * it is.
 *
 * @example
 * ```ts
 * const pair: PairParams = { code: "4821", device: { model: "SM-A266B", os: "Android 15", engine: "0.14.12+9c41e0" } };
 * ```
 */
export type PairParams = {
  /** Exactly 4 digits, e.g. "4821", "0421". */
  readonly code: string;
  readonly device: {
    /** The phone's model, e.g. "SM-A266B" (normalized by the hub). */
    readonly model?: string;
    /** The phone's system, e.g. "Android 15". */
    readonly os?: string;
    /** The phone's `__MOKU_GAME_ENGINE__`, e.g. "0.14.12+9c41e0". */
    readonly engine?: string;
    /** The phone's `__MOKU_GAME_BUILD__`, e.g. "debug-20261014T160000Z". */
    readonly build?: string;
  };
};

/**
 * Params of the hub→device editor-channel notification `paired`: the device id and token to
 * reconnect with, and the computer's engine fingerprint.
 *
 * @example
 * ```ts
 * const paired: PairedParams = { device: "d-7f3a", token: "9f2c…", engine: "0.14.12+9c41e0" };
 * ```
 */
export type PairedParams = {
  readonly device: string;
  readonly token: string;
  readonly engine: string;
};

/**
 * Params of the device→hub editor-channel notification `perf.lines`: a batch of the device's log.
 *
 * @example
 * ```ts
 * const batch: PerfLinesParams = {
 *   log: "perf-20261014-1532-sm-a266b.jsonl",
 *   from: 0,
 *   lines: [{ v: 1, kind: "mark", t: 5917.4, build: null, label: "boss", auto: false }]
 * };
 * ```
 */
export type PerfLinesParams = {
  /** The device log's name, e.g. "perf-20261014-1532-sm-a266b.jsonl". */
  readonly log: string;
  /** Index of `lines[0]` in that log, 0-based. */
  readonly from: number;
  /** PerfLogLine v1 objects, JSON objects on the wire. */
  readonly lines: readonly LinkJson[];
};

/**
 * Params of the hub→device editor-channel notification `perf.ack`: the next index the hub expects
 * of a log, and how many lines of the batch it took.
 *
 * @example
 * ```ts
 * const ack: PerfAckParams = { log: "perf-20261014-1532-sm-a266b.jsonl", next: 200, n: 200 };
 * ```
 */
export type PerfAckParams = { readonly log: string; readonly next: number; readonly n: number };

/**
 * The engine of the computer (engine spec 10 E1 without `folder`), published to tools as
 * `editor.engine`.
 *
 * @example
 * ```ts
 * const engine: EngineInfo = { id: "0.14.12+9c41e0", version: "0.14.12", dist: "9c41e0…" };
 * ```
 */
export type EngineInfo = {
  /** "0.14.12+9c41e0", "0.0.0+src" or "unknown". */
  readonly id: string;
  readonly version: string;
  readonly dist: string;
  readonly patch?: { readonly file: string; readonly hash: string };
};

/**
 * A device session's device, on `SessionInfo.device`.
 *
 * @example
 * ```ts
 * const device: SessionDevice = {
 *   id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", port: 47600,
 *   engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z"
 * };
 * ```
 */
export type SessionDevice = {
  /** The device id the hub issued, e.g. "d-7f3a". */
  readonly id: string;
  /** The normalized model, e.g. "SM-A266B". */
  readonly model: string | null;
  readonly link: DeviceLinkKind;
  /** The phone's address as the hub saw it: "127.0.0.1" (adb), "192.168.1.23" (LAN). */
  readonly address: string;
  /** The port of the device listener it reached, e.g. 47600. */
  readonly port: number;
  readonly engine: string | null;
  readonly build: string | null;
};

/**
 * The device link of the bridge: what the overlay's Link tab and the pill's link light show.
 *
 * @example
 * ```ts
 * const live: DeviceLink = { mode: "adb", address: "127.0.0.1:47600", editorEngine: "0.14.12+9c41e0", seenAt: 1760454000000 };
 * ```
 */
export type DeviceLink = {
  /**
   * "none": no computer reached (lost, retrying quietly, or refused); "connecting": a socket opening
   * or pairing; "adb": open at a loopback address (adb reverse); "lan": open at any other address.
   */
  readonly mode: "none" | "connecting" | "adb" | "lan";
  /** The `host:port` dialled. */
  readonly address: string;
  /** Present while the computer has not confirmed this phone: the code the person types on the computer. */
  readonly pairing?: { readonly code: string };
  /** The computer's engine fingerprint; absent before the first session or paired notification. */
  readonly editorEngine?: string;
  /** Epoch ms of the last sign of the computer; absent before the first one. */
  readonly seenAt?: number;
};

/**
 * Normalizes a device model the engine's way: trimmed, whitespace runs to "-", upper case, at most
 * 64 characters; an empty or non-string value gives null.
 *
 * @param _raw - The model as a phone, the shell or adb reported it.
 * @throws {Error} Always, until unit 01 implements it.
 * @example
 * ```ts
 * normalizeModel(" sm a266b "); // "SM-A266B"
 * ```
 */
export function normalizeModel(_raw: unknown): string | null {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Checks the params of a `pair` notification: the code must be exactly 4 digits.
 *
 * @param _params - The notification's params as they arrived.
 * @throws {Error} Always, until unit 01 implements it.
 * @example
 * ```ts
 * parsePairParams({ code: "48", device: {} }); // undefined
 * ```
 */
export function parsePairParams(_params: LinkJson | undefined): PairParams | undefined {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Checks the params of a `perf.lines` notification.
 *
 * @param _params - The notification's params as they arrived.
 * @throws {Error} Always, until unit 01 implements it.
 * @example
 * ```ts
 * parsePerfLinesParams({ log: "perf-20261014-1532-sm-a266b.jsonl", from: -1, lines: [] }); // undefined
 * ```
 */
export function parsePerfLinesParams(_params: LinkJson | undefined): PerfLinesParams | undefined {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Checks a `host:port` or `[ipv6]:port` address (trimmed; port 1–65535) and normalizes its text.
 *
 * @param _text - The address as typed or configured.
 * @throws {Error} Always, until unit 01 implements it.
 * @example
 * ```ts
 * parseAddress(" 192.168.1.5:47600 ")?.text; // "192.168.1.5:47600"
 * ```
 */
export function parseAddress(
  _text: string
): { readonly host: string; readonly port: number; readonly text: string } | undefined {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Whether a host is the loopback: 127.0.0.0/8, `localhost` or `::1`.
 *
 * @param _host - A host of `parseAddress`.
 * @throws {Error} Always, until unit 01 implements it.
 * @example
 * ```ts
 * isLoopback("192.168.1.5"); // false
 * ```
 */
export function isLoopback(_host: string): boolean {
  throw new Error(NOT_IMPLEMENTED);
}
