/**
 * @file Device-link wire module (hub/protocol, runtime-free): the types, constants and helpers of a
 * phone's link to the editor server — pairing, the device's perf log batches, the computer's engine
 * fingerprint, the device of a session and the bridge's link state. It imports nothing: it declares
 * its own `LinkJson`, so the only edge between the protocol modules is registry/protocol → here,
 * type-only. The agent's bridge and overlay import `../hub/protocol`, never the hub plugin.
 */

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

/** The longest normalized model, in characters (the engine's header rule). */
const MAX_MODEL = 64;

/** A pairing code: exactly four decimal digits, leading zeros kept. */
const PAIR_CODE = /^\d{4}$/;

/** A device log name: 1–128 word characters, dots or hyphens. */
const LOG_NAME = /^[\w.-]{1,128}$/;

/** The most lines one `perf.lines` batch may carry. */
const MAX_BATCH_LINES = 5000;

/** The highest TCP port. */
const MAX_PORT = 65_535;

/** A port as typed: one to five digits. */
const PORT_TEXT = /^\d{1,5}$/;

/** One label of a DNS name: letters, digits and hyphens. */
const NAME_LABEL = /^[\da-z-]{1,63}$/i;

/** The longest DNS name. */
const MAX_NAME = 253;

/** The characters of an IPv6 literal (checked loosely: the socket refuses a wrong one). */
const IPV6_TEXT = /^[\da-f:.]{2,45}$/i;

/** One part of a dotted IPv4 literal. */
const IPV4_PART = /^\d{1,3}$/;

/** The highest value of one IPv4 part. */
const MAX_IPV4_PART = 255;

/** The first part of every IPv4 loopback address (127.0.0.0/8). */
const LOOPBACK_NET = 127;

/** The device fields of a `pair` that are kept when they are strings. */
const DEVICE_FIELDS = ["model", "os", "engine", "build"] as const;

/** The longest device field of a `pair` (model, os, engine, build), in characters. */
const MAX_DEVICE_TEXT = 128;

/**
 * The code point ranges a device's text must not carry: C0 controls, DEL and C1 controls, the bidi
 * embeddings and overrides (U+202A–U+202E) and the bidi isolates (U+2066–U+2069). They could
 * rewrite the terminal's pairing question or a log line.
 */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x20_2a, 0x20_2e],
  [0x20_66, 0x20_69]
];

/** Whitespace: kept by normalizeModel's own rule (trimmed, inner runs to "-"). */
const WHITESPACE = /^\s$/;

/** The device of a `pair`, being built. */
type MutablePairDevice = { -readonly [K in keyof PairParams["device"]]: PairParams["device"][K] };

/** A JSON object of the wire. */
type LinkObject = { [key: string]: LinkJson };

/**
 * True for a control or bidi character (one of UNSAFE_RANGES). Also the rule of a tools client's
 * name (`clientNameOf` in tools-link.ts); not re-exported by the barrel.
 *
 * @param char - One character (one code point).
 * @returns Whether it is unsafe in a device's text.
 * @example
 * ```ts
 * isUnsafeChar("\u202E"); // true
 * ```
 */
export function isUnsafeChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high);
}

/**
 * True for a device field of a `pair` the hub takes: at most 128 characters, no control and no
 * bidi character.
 *
 * @param text - The field's value.
 * @returns Whether it is clean.
 * @example
 * ```ts
 * isCleanText("Android 15"); // true
 * ```
 */
function isCleanText(text: string): boolean {
  return text.length <= MAX_DEVICE_TEXT && ![...text].some(char => isUnsafeChar(char));
}

/**
 * The value as a JSON object, or undefined for null, an array or a scalar.
 *
 * @param value - A decoded JSON value.
 * @returns The object, or undefined.
 * @example
 * ```ts
 * objectOf({ code: "4821" }); // { code: "4821" }
 * ```
 */
function objectOf(value: LinkJson | undefined): LinkObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

/**
 * The parts of a dotted IPv4 literal, or undefined when the text is not one.
 *
 * @param text - A host.
 * @returns The four parts.
 * @example
 * ```ts
 * ipv4Of("127.0.0.2"); // [127, 0, 0, 2]
 * ```
 */
function ipv4Of(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every(part => IPV4_PART.test(part))) return undefined;

  const numbers = parts.map(Number);
  return numbers.every(part => part <= MAX_IPV4_PART) ? numbers : undefined;
}

/**
 * True for a DNS name or an IPv4 literal: an all-digit name must be a valid IPv4 literal.
 *
 * @param host - A lower-cased host.
 * @returns Whether it is a host of `host:port`.
 * @example
 * ```ts
 * isHostName("my-pc.local"); // true
 * ```
 */
function isHostName(host: string): boolean {
  const labels = host.split(".");
  if (labels.every(label => IPV4_PART.test(label))) return ipv4Of(host) !== undefined;

  return (
    host.length <= MAX_NAME &&
    labels.every(label => NAME_LABEL.test(label) && !label.startsWith("-") && !label.endsWith("-"))
  );
}

/**
 * The port of an address, or undefined when it is not a whole number from 1 to 65535.
 *
 * @param text - The text after the last colon.
 * @returns The port.
 * @example
 * ```ts
 * portOf("47600"); // 47600
 * ```
 */
function portOf(text: string): number | undefined {
  if (!PORT_TEXT.test(text)) return undefined;

  const port = Number(text);
  return port >= 1 && port <= MAX_PORT ? port : undefined;
}

/**
 * Normalizes a device model the engine's way: control and bidi characters dropped (whitespace
 * controls such as adb's trailing newline count as whitespace), trimmed, whitespace runs to "-",
 * upper case, at most 64 characters; an empty or non-string value gives null. The hub, the
 * collector's adb reading and the phone's log header agree through it.
 *
 * @param raw - The model as a phone, the shell or adb reported it.
 * @returns The model, or null.
 * @example
 * ```ts
 * normalizeModel(" sm a266b "); // "SM-A266B"
 * ```
 */
export function normalizeModel(raw: unknown): string | null {
  const kept =
    typeof raw === "string"
      ? [...raw].filter(char => WHITESPACE.test(char) || !isUnsafeChar(char)).join("")
      : "";
  const model = kept.trim().replaceAll(/\s+/g, "-").toUpperCase().slice(0, MAX_MODEL);

  // eslint-disable-next-line unicorn/no-null -- null is "no model" on the wire (SessionDevice.model)
  return model === "" ? null : model;
}

/**
 * Checks the params of a `pair` notification: an object whose code is exactly four digits and
 * whose `device` is an object. Of the device, only the string fields model, os, engine and build
 * are kept; one of them over 128 characters or with a control or bidi character (C0, DEL, C1,
 * U+202A–U+202E, U+2066–U+2069) makes the pair malformed, so every reader (the terminal's
 * question, the logs, `SessionInfo.device`) gets clean text.
 *
 * @param params - The notification's params as they arrived.
 * @returns The params, or undefined when they are malformed.
 * @example
 * ```ts
 * parsePairParams({ code: "0421", device: { model: "SM-A266B" } }); // { code: "0421", device: { model: "SM-A266B" } }
 * parsePairParams({ code: "48", device: {} }); // undefined
 * ```
 */
export function parsePairParams(params: LinkJson | undefined): PairParams | undefined {
  const fields = objectOf(params);
  const info = objectOf(fields?.device);
  const code = fields?.code;
  if (info === undefined || typeof code !== "string" || !PAIR_CODE.test(code)) return undefined;

  const device: MutablePairDevice = {};
  for (const key of DEVICE_FIELDS) {
    const value = info[key];
    if (typeof value !== "string") continue;
    if (!isCleanText(value)) return undefined;
    device[key] = value;
  }
  return { code, device };
}

/**
 * Checks the params of a `perf.lines` notification: `log` of 1–128 word characters, dots or
 * hyphens, `from` a safe integer ≥ 0, `lines` a list of 1–5000 items. The items themselves are
 * checked by the hub one by one.
 *
 * @param params - The notification's params as they arrived.
 * @returns The params, or undefined when they are malformed.
 * @example
 * ```ts
 * parsePerfLinesParams({ log: "perf-20261014-1532-sm-a266b.jsonl", from: -1, lines: [] }); // undefined
 * ```
 */
export function parsePerfLinesParams(params: LinkJson | undefined): PerfLinesParams | undefined {
  const fields = objectOf(params);
  const log = fields?.log;
  const from = fields?.from;
  const lines = fields?.lines;
  if (typeof log !== "string" || !LOG_NAME.test(log)) return undefined;
  if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 0) return undefined;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_BATCH_LINES) {
    return undefined;
  }

  return { log, from, lines };
}

/**
 * Checks a `host:port` (a DNS name or an IPv4 literal) or `[ipv6]:port` address, trimmed, port
 * 1–65535, and normalizes it: the host lower-cased, the port without leading zeros.
 *
 * @param text - The address as typed or configured.
 * @returns The host (IPv6 without brackets), the port and the normalized text, or undefined.
 * @example
 * ```ts
 * parseAddress(" 192.168.1.5:47600 ")?.text; // "192.168.1.5:47600"
 * parseAddress("[::1]:47600")?.host; // "::1"
 * parseAddress("192.168.1.5"); // undefined
 * ```
 */
export function parseAddress(
  text: string
): { readonly host: string; readonly port: number; readonly text: string } | undefined {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]:");
    const host = trimmed.slice(1, end);
    const port = end === -1 ? undefined : portOf(trimmed.slice(end + 2));
    return port !== undefined && IPV6_TEXT.test(host) && host.includes(":")
      ? { host, port, text: `[${host}]:${port}` }
      : undefined;
  }

  const colon = trimmed.lastIndexOf(":");
  const host = trimmed.slice(0, colon);
  const port = colon === -1 ? undefined : portOf(trimmed.slice(colon + 1));
  return port !== undefined && isHostName(host)
    ? { host, port, text: `${host}:${port}` }
    : undefined;
}

/**
 * Whether a host is the loopback: any address of 127.0.0.0/8, `localhost` or `::1`. A phone that
 * reaches the computer at such an address came through adb reverse.
 *
 * @param host - A host of `parseAddress`.
 * @returns Whether it is the loopback.
 * @example
 * ```ts
 * isLoopback("127.0.0.2"); // true
 * isLoopback("192.168.1.5"); // false
 * ```
 */
export function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "::1") return true;

  return ipv4Of(lower)?.[0] === LOOPBACK_NET;
}
