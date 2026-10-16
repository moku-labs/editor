/**
 * @file connect/protocol — the wire types of the device directory (`editor.devices`) and the wired
 * telemetry (`editor.deviceTelemetry`) the server's connect plugin publishes to the tools page (spec
 * 11 § 3 "Wire types"). Runtime-free and type-only: its one import is the type-only edge to
 * hub/protocol (the device link kind). registry/protocol imports this file type-only (one-way edge
 * registry → connect/protocol); this file never imports registry/protocol.
 */
import type { DeviceLinkKind } from "../../hub/protocol";

/**
 * Why a reading is not available: not by wire, an iPhone, a node SELinux hides, a file adb could not
 * read, a format the parser does not know, a process or node not found, two candidates, no WebView
 * devtools socket, no CDP target for the session's page, the first tick of a CPU delta, adb missing,
 * or another failure.
 *
 * @example
 * ```ts
 * const reason: ReadingOffReason = "no-devtools-socket"; // a release build: WebView debugging is off
 * ```
 */
export type ReadingOffReason =
  | "not-wired"
  | "ios"
  | "no-permission"
  | "unreadable"
  | "unknown-format"
  | "not-found"
  | "ambiguous"
  | "no-devtools-socket"
  | "no-target"
  | "warming-up"
  | "adb-missing"
  | "error";

/**
 * A reading that may be unavailable; every reading names where it came from (`"/sys/kernel/gpu"`,
 * `"/proc/<pid>/stat"`, `"dumpsys meminfo"`, `"cdp Runtime.getHeapUsage"`, `"none"` …). A reading that
 * is not available has no value.
 *
 * @example
 * ```ts
 * const gpu: Reading<number> = { available: true, source: "/sys/kernel/gpu", value: 221 };
 * const off: Reading<number> = { available: false, source: "none", reason: "not-wired" };
 * ```
 */
export type Reading<T> =
  | { readonly available: true; readonly source: string; readonly value: T }
  | { readonly available: false; readonly source: string; readonly reason: ReadingOffReason };

/**
 * Device mode's listen addresses as published: the device port, the adb listener and the LAN
 * listener (null while it is off). The hub's own `DeviceListen` is its API type; this is the wire
 * copy with the same fields.
 *
 * @example
 * ```ts
 * const listen: ListenInfo = { port: 47600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" };
 * ```
 */
export type ListenInfo = {
  readonly port: number;
  readonly adb: string;
  readonly lan: string | null;
};

/**
 * A phone `adb devices -l` lists, with its getprop facts and how far it got: unauthorized, offline,
 * ready (device mode off), waiting for its debug game, no agent answered, or linked to a device.
 *
 * @example
 * ```ts
 * const phone: WireDevice = { serial: "R5CX30ABCDE", state: "device", transport: "usb", model: "SM-A266B",
 *   name: "Galaxy A26", os: "Android 15", phase: "linked", device: "d-7f3a" };
 * ```
 */
export type WireDevice = {
  /** "R5CX30ABCDE", "192.168.1.23:37011" or "adb-R5CX…._adb-tls-connect._tcp". */
  readonly serial: string;
  readonly state: "device" | "unauthorized" | "offline" | "other";
  /** "wifi" for an `ip:port` or `_adb-tls-connect` serial (Android 11+ wireless debugging). */
  readonly transport: "usb" | "wifi";
  /** The normalized model, "SM-A266B"; null before getprop answered. */
  readonly model: string | null;
  /** The marketing name when getprop has one, "Galaxy A26". */
  readonly name: string | null;
  /** "Android 15". */
  readonly os: string | null;
  readonly phase: "unauthorized" | "offline" | "ready" | "waiting" | "no-agent" | "linked";
  /** The matched linked device id, "d-7f3a"; null while none matched. */
  readonly device: string | null;
  /** Two linked phones of one model: no telemetry, the panel says which is ambiguous. */
  readonly match?: "ambiguous";
};

/**
 * A pairing waiting for the person at the computer. It carries no code: the person types the code the
 * phone shows, and connect compares it.
 *
 * @example
 * ```ts
 * const ask: PairAsk = { ticket: "p-3a1f", model: "SM-A266B", address: "192.168.1.23", link: "lan",
 *   engine: "0.15.0+9c41e0", build: "debug-20261016T090000Z", since: 1791986083963 };
 * ```
 */
export type PairAsk = {
  /** "p-" and 4 hex characters. */
  readonly ticket: string;
  readonly model: string | null;
  /** The phone's address as the hub saw it, "192.168.1.23". */
  readonly address: string;
  readonly link: DeviceLinkKind;
  readonly engine: string | null;
  readonly build: string | null;
  /** Epoch ms of the request. */
  readonly since: number;
};

/**
 * A device linked in this device-mode run, as published (the hub's `devices()` without pairing
 * detail), with its open session.
 *
 * @example
 * ```ts
 * const linked: LinkedEntry = { id: "d-7f3a", model: "SM-A266B", link: "adb", address: "127.0.0.1", online: true,
 *   engine: "0.15.0+9c41e0", build: "debug-20261016T090000Z", latencyMs: 9, session: "s-9" };
 * ```
 */
export type LinkedEntry = {
  readonly id: string;
  readonly model: string | null;
  readonly link: DeviceLinkKind;
  readonly address: string;
  readonly online: boolean;
  readonly engine: string | null;
  readonly build: string | null;
  /** The hub's WebSocket ping round trip, ms; null before the first pong. */
  readonly latencyMs: number | null;
  /** The device's open session id ("s-9"), the session whose `device.id` is this id; null while away. */
  readonly session: string | null;
};

/**
 * The device directory, published as `editor.devices`: device mode, where a LAN pairing is
 * confirmed, adb's availability, the phones adb lists, the pairings asking and the devices linked.
 *
 * @example
 * ```ts
 * const directory: DeviceDirectory = { v: 1, mode: { on: true, owner: "connect", listen: { port: 47600, adb: "127.0.0.1:47600", lan: null } },
 *   confirmIn: "page", adb: { available: true }, wire: [], asking: [], linked: [], at: 1791986083963 };
 * ```
 */
export type DeviceDirectory = {
  readonly v: 1;
  readonly mode: {
    readonly on: boolean;
    /** "connect": the tools page turned device mode on; "other": `moku-editor perf` did. */
    readonly owner: "connect" | "other" | null;
    readonly listen: ListenInfo | null;
  };
  /** Where a LAN pairing is confirmed: the tools page, perf's terminal, or nowhere (device mode off). */
  readonly confirmIn: "page" | "terminal" | null;
  readonly adb: { readonly available: boolean; readonly reason?: "missing" | "error" };
  readonly wire: readonly WireDevice[];
  readonly asking: readonly PairAsk[];
  readonly linked: readonly LinkedEntry[];
  /** Epoch ms of the build of this directory. */
  readonly at: number;
};

/**
 * CPU of one process over the last tick: % of all cores and % of one core (top's style).
 *
 * @example
 * ```ts
 * const app: ProcessCpu = { pid: 23811, name: "com.moku.garden", pct: 14.2, oneCorePct: 113.6 };
 * ```
 */
export type ProcessCpu = {
  readonly pid: number;
  readonly name: string;
  readonly pct: number;
  readonly oneCorePct: number;
};

/**
 * Memory of one process from `dumpsys meminfo` (every 5 s), MB: the whole process, never the JS heap.
 * A row the table did not have is null, never 0.
 *
 * @example
 * ```ts
 * const app: ProcessMemory = { pid: 23811, totalPssMb: 541, javaMb: 18.2, nativeMb: 96.4, graphicsMb: 210.5, glMb: 180.1,
 *   codeMb: 61.3, stackMb: 1.2, otherMb: 22.4, systemMb: 31.9, at: 1791986080000 };
 * ```
 */
export type ProcessMemory = {
  readonly pid: number;
  readonly totalPssMb: number;
  readonly javaMb: number | null;
  readonly nativeMb: number | null;
  readonly graphicsMb: number | null;
  readonly glMb: number | null;
  readonly codeMb: number | null;
  readonly stackMb: number | null;
  readonly otherMb: number | null;
  readonly systemMb: number | null;
  /** Epoch ms of the reading. */
  readonly at: number;
};

/**
 * The GPU reading of a wired phone: clock and busy now, and the clock range (null when the node does
 * not say).
 *
 * @example
 * ```ts
 * const gpu: GpuLoad = { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 };
 * ```
 */
export type GpuLoad = {
  readonly mhz: number | null;
  readonly busyPct: number | null;
  readonly minMhz: number | null;
  readonly maxMhz: number | null;
};

/**
 * One JS heap sample of the WebView over CDP (`Runtime.getHeapUsage`), `t` in computer epoch ms.
 *
 * @example
 * ```ts
 * const sample: HeapSample = { t: 1791986083713, usedMb: 41.9, totalMb: 64 };
 * ```
 */
export type HeapSample = { readonly t: number; readonly usedMb: number; readonly totalMb: number };

/**
 * A GC: inferred from a heap drop of at least `gcDropMb` between two samples (`inferred: true`), or
 * exact from CDP Tracing (`gcTrace`), `t` in computer epoch ms.
 *
 * @example
 * ```ts
 * const gc: HeapGc = { t: 1791986083713, freedMb: 26, inferred: true };
 * ```
 */
export type HeapGc = { readonly t: number; readonly freedMb: number; readonly inferred: boolean };

/**
 * One wired telemetry record of a watched device (1 Hz), published as `editor.deviceTelemetry` and
 * emitted as connect's `connect:telemetry`. Times are computer epoch ms. Every reading names its
 * source and degrades alone.
 *
 * @example
 * ```ts
 * const record: DeviceTelemetry = { v: 1, device: "d-7f3a", serial: "R5CX30ABCDE", at: 1791986083963, wired: true,
 *   gpu: { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 } },
 *   cpu: { cores: 8,
 *     app: { available: true, source: "/proc/23811/stat", value: { pid: 23811, name: "com.moku.garden", pct: 14.2, oneCorePct: 113.6 } },
 *     renderer: { available: false, source: "none", reason: "ambiguous" },
 *     surfaceflinger: { available: true, source: "/proc/612/stat", value: { pid: 612, name: "surfaceflinger", pct: 2.1, oneCorePct: 16.8 } } },
 *   memory: { app: { available: false, source: "dumpsys meminfo", reason: "warming-up" }, renderer: { available: false, source: "dumpsys meminfo", reason: "warming-up" } },
 *   heap: { available: false, source: "none", reason: "no-devtools-socket" } };
 * ```
 */
export type DeviceTelemetry = {
  readonly v: 1;
  /** The linked device id, "d-7f3a". */
  readonly device: string;
  readonly serial: string | null;
  readonly at: number;
  readonly wired: boolean;
  readonly gpu: Reading<GpuLoad>;
  readonly cpu: {
    /** Cores of the phone (`cpuN` lines of /proc/stat); null before the probe. */
    readonly cores: number | null;
    readonly app: Reading<ProcessCpu>;
    readonly renderer: Reading<ProcessCpu>;
    readonly surfaceflinger: Reading<ProcessCpu>;
  };
  readonly memory: {
    readonly app: Reading<ProcessMemory>;
    readonly renderer: Reading<ProcessMemory>;
  };
  readonly heap: Reading<{
    readonly samples: readonly HeapSample[];
    readonly gcs: readonly HeapGc[];
  }>;
};

/**
 * Why a watch has no telemetry: a LAN device, an iPhone, a device not linked, adb missing, or two
 * phones of one model.
 *
 * @example
 * ```ts
 * const reason: TelemetryOffReason = "not-wired"; // connect.watch of a phone on the network
 * ```
 */
export type TelemetryOffReason = "not-wired" | "ios" | "not-linked" | "adb-missing" | "ambiguous";
