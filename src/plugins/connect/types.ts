/**
 * @file connect plugin — type definitions: the config, the adb seam and its commands (the A0–A10
 * allowlist), the CDP seams, the records of the state (phones adb lists, pairings asking, telemetry
 * attaches), the state, the per-plugin event `connect:telemetry`, the api and the domain context.
 * The wire types of `connect/protocol` are re-exported for the plugin's own files and the `Connect`
 * namespace of the server entry.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require } from "../../config";
import type { DeviceListen, HubDeviceEvent, PairRequest } from "../hub/types";
import type {
  DeviceDirectory,
  DeviceTelemetry,
  HeapSample,
  ProcessMemory,
  Reading,
  ReadingOffReason,
  TelemetryOffReason,
  WireDevice
} from "./protocol";

export type {
  DeviceDirectory,
  DeviceTelemetry,
  GpuLoad,
  HeapGc,
  HeapSample,
  LinkedEntry,
  ListenInfo,
  PairAsk,
  ProcessCpu,
  ProcessMemory,
  Reading,
  ReadingOffReason,
  TelemetryOffReason,
  WireDevice
} from "./protocol";

/**
 * Connect configuration (spec 11 § 3 Config). Flat: per-plugin config merges shallowly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { connect: { adb: "/opt/android/platform-tools/adb", wire: "auto" } } });
 * ```
 */
export type ConnectConfig = {
  /** The adb command, a name on PATH or a path. */
  adb: string;
  /** One adb call is killed after this many ms. */
  adbTimeoutMs: number;
  /** `adb devices -l` period while a scan lease or device mode is on. */
  scanEveryMs: number;
  /** A ready phone with no device session for this long reads "no debug game answered". */
  answerTimeoutMs: number;
  /** A scan or watch lease not renewed for this long ends. */
  leaseMs: number;
  /** The wired telemetry tick. */
  telemetryEveryMs: number;
  /** `dumpsys meminfo` period. */
  meminfoEveryMs: number;
  /** CDP Runtime.getHeapUsage period. */
  heapEveryMs: number;
  /** A heap drop of at least this many MB between two samples is an inferred GC. */
  gcDropMb: number;
  /**
   * Exact GC events through CDP Tracing (heavier). The CDP client then also accepts
   * `Tracing.start` / `Tracing.end`; the trace reading itself waits for a measurement on the A26
   * (decision 2026-10-16), so GCs stay inferred.
   */
  gcTrace: boolean;
  /** "auto": turn the adb listener on at start when adb is on PATH and the port is free. */
  wire: "manual" | "auto";
};

/**
 * What one adb command answered: its exit code (−1 when it was killed after `adbTimeoutMs`), its
 * standard output, and whether adb could not be spawned at all (code 127).
 *
 * @example
 * ```ts
 * const missing: AdbResult = { code: 127, text: "", missing: true };
 * ```
 */
export type AdbResult = { readonly code: number; readonly text: string; readonly missing: boolean };

/**
 * Runs one adb command: `runAdb` in the plugin, a fake in tests. Never rejects. Only `wire/run.ts`
 * calls it, with the argv `adbArgs` built from an allowlisted AdbCommand.
 *
 * @example
 * ```ts
 * const fake: AdbRunner = async (_adb, args) => ({ code: 0, text: args[0] === "devices" ? "List of devices attached\n" : "", missing: false });
 * ```
 */
export type AdbRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<AdbResult>;

/**
 * One allowlisted adb command (spec 11 C7, A0–A10). Nothing else reaches adb: `adbArgs` builds the
 * argv from this union only and validates every token first.
 *
 * @example
 * ```ts
 * const tick: AdbCommand = { kind: "head", serial: "R5CX30ABCDE", lines: 1, paths: ["/proc/stat", "/proc/23811/stat", "/sys/kernel/gpu/gpu_clock"] };
 * ```
 */
export type AdbCommand =
  | { readonly kind: "version" }
  | { readonly kind: "devices" }
  | { readonly kind: "getprop"; readonly serial: string }
  | { readonly kind: "unix-sockets"; readonly serial: string }
  | { readonly kind: "processes"; readonly serial: string }
  | {
      readonly kind: "head";
      readonly serial: string;
      readonly lines: number;
      readonly paths: readonly string[];
    }
  | { readonly kind: "devfreq"; readonly serial: string }
  | { readonly kind: "meminfo"; readonly serial: string; readonly pid: number }
  | { readonly kind: "forward"; readonly serial: string; readonly socket: string }
  | { readonly kind: "forward-remove"; readonly serial: string; readonly port: number };

/**
 * One phone line of `adb devices -l`.
 *
 * @example
 * ```ts
 * const listed: ListedDevice = { serial: "R5CX30ABCDE", state: "device", transport: "usb" };
 * ```
 */
export type ListedDevice = {
  readonly serial: string;
  readonly state: WireDevice["state"];
  readonly transport: WireDevice["transport"];
};

/**
 * What getprop says about a phone.
 *
 * @example
 * ```ts
 * const facts: DeviceFacts = { model: "SM-A266B", name: "Galaxy A26", os: "Android 15" };
 * ```
 */
export type DeviceFacts = {
  readonly model: string | null;
  readonly name: string | null;
  readonly os: string | null;
};

/**
 * One process of `ps -A -o PID,NAME`.
 *
 * @example
 * ```ts
 * const process: PsProcess = { pid: 612, name: "surfaceflinger" };
 * ```
 */
export type PsProcess = { readonly pid: number; readonly name: string };

/**
 * What one `head` call printed, by path: the text of each file it could read, and the paths it was
 * refused (an old adb that merges stderr prints `head: <path>: Permission denied`).
 *
 * @example
 * ```ts
 * const read: HeadRead = { sections: new Map([["/sys/kernel/gpu/gpu_clock", "221"]]), denied: new Set() };
 * ```
 */
export type HeadRead = {
  readonly sections: ReadonlyMap<string, string>;
  readonly denied: ReadonlySet<string>;
};

/**
 * One GPU sysfs node: the file, the reading's source (its folder), what it gives and how its first
 * line is written.
 *
 * @example
 * ```ts
 * const node: GpuNode = { path: "/sys/kernel/gpu/gpu_clock", source: "/sys/kernel/gpu", reads: "clock", format: "mhz" };
 * ```
 */
export type GpuNode = {
  readonly path: string;
  readonly source: string;
  readonly reads: "clock" | "busy" | "min" | "max";
  /**
   * mhz "221"; hz "585000000"; khz-pair "0 836000" (index, kHz); percent "63 %"; busy-total
   * "120 400"; utilization "35 0 65" (loading first).
   */
  readonly format: "mhz" | "hz" | "khz-pair" | "percent" | "busy-total" | "utilization";
};

/**
 * One of the three processes the telemetry reads.
 */
export type ProcessRole = "app" | "renderer" | "surfaceflinger";

/**
 * A process the probe looked for: found with its pid and name, or not with the reason.
 *
 * @example
 * ```ts
 * const app: ProcessFind = { found: true, pid: 23811, name: "com.moku.garden.debug" };
 * ```
 */
export type ProcessFind =
  | { readonly found: true; readonly pid: number; readonly name: string }
  | { readonly found: false; readonly reason: "not-found" | "ambiguous" };

/**
 * What the probe found on a phone once per attach: cores, the three processes and the GPU nodes.
 */
export type Probe = {
  readonly cores: number | null;
  readonly app: ProcessFind;
  readonly renderer: ProcessFind;
  readonly surfaceflinger: ProcessFind;
  readonly gpu: readonly GpuNode[];
};

/**
 * The CPU counters of one tick: total jiffies of `/proc/stat` and `utime + stime` per pid.
 */
export type CpuCounters = { readonly total: number; readonly ticks: ReadonlyMap<number, number> };

/**
 * One parsed `/proc/<pid>/stat` line: pid, comm, user and system ticks, start time (field 22).
 *
 * @example
 * ```ts
 * const stat: ProcStat = { pid: 23811, name: "com.moku.garden.debug", utime: 1420, stime: 310, start: 52000 };
 * ```
 */
export type ProcStat = {
  readonly pid: number;
  readonly name: string;
  readonly utime: number;
  readonly stime: number;
  readonly start: number;
};

/**
 * The socket side of a CDP connection: Bun's WebSocket in the plugin, a fake in tests.
 */
export type CdpSocket = {
  /**
   * Writes one text frame.
   *
   * @param text - The JSON message.
   */
  send(text: string): void;
  /** Closes the socket. */
  close(): void;
};

/**
 * What a CDP socket tells its client.
 */
export type CdpSocketEvents = {
  /** The socket opened. */
  readonly onOpen: () => void;
  /** A text frame arrived. */
  readonly onMessage: (text: string) => void;
  /** The socket closed or failed. */
  readonly onClose: () => void;
};

/**
 * Opens a CDP WebSocket with no Origin header (Chrome refuses a DevTools socket whose Origin is
 * not allowed; a client that sends none is accepted).
 *
 * @example
 * ```ts
 * const open: CdpOpen = (url, events) => fakeSocket(url, events);
 * ```
 */
export type CdpOpen = (url: string, events: CdpSocketEvents) => CdpSocket;

/**
 * Fetches a JSON document (`/json/list` of a forwarded devtools socket); rejects on a network error,
 * a status other than 200 or the timeout.
 *
 * @example
 * ```ts
 * const fetchJson: FetchJson = async url => (await fetch(url)).json();
 * ```
 */
export type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

/**
 * The client of one CDP connection. `send` refuses every method outside the allowlist before it
 * writes anything.
 */
export type CdpClient = {
  /**
   * Sends one allowlisted method and resolves with its result.
   *
   * @param method - The CDP method, e.g. "Runtime.getHeapUsage".
   * @returns The result object (unknown shape: the caller narrows it).
   * @throws {Error} At once, writing nothing, for a method outside the allowlist.
   */
  send(method: string): Promise<unknown>;
  /** Closes the socket; every pending call rejects. */
  close(): void;
  /** True once the socket closed. */
  readonly closed: () => boolean;
};

/**
 * The process, network and socket seams of connect: the runtime's in the plugin, fakes in tests.
 */
export type ConnectDeps = {
  readonly run: AdbRunner;
  readonly fetchJson: FetchJson;
  readonly openSocket: CdpOpen;
};

/**
 * A phone `adb devices -l` lists, with what getprop said once it was ready.
 */
export type WireRecord = {
  readonly serial: string;
  state: WireDevice["state"];
  transport: WireDevice["transport"];
  /** getprop's answer; undefined before it came. */
  facts: DeviceFacts | undefined;
  /** getprop was asked (in flight or answered); reset when it failed. */
  asked: boolean;
  /** Epoch ms since the phone is listed ready (state `device`); undefined while it is not. */
  readySince: number | undefined;
};

/**
 * A pairing waiting for the person. The request keeps the code: it never leaves connect.
 */
export type AskRecord = {
  readonly ticket: string;
  readonly request: PairRequest;
  /** Epoch ms of the request. */
  readonly since: number;
  /**
   * Answers the hub's question and removes the ticket from `asking`; a second call does nothing.
   *
   * @param paired - True pairs the phone.
   */
  readonly settle: (paired: boolean) => void;
};

/**
 * The CDP link of an attach: the client, the local port of its adb forward and the socket name.
 */
export type CdpLink = {
  readonly client: CdpClient;
  readonly port: number;
  readonly socket: string;
};

/**
 * The heap side of an attach: samples since the last tick, the last sample before them (a GC
 * across two ticks), why there is no CDP, and whether a sample is in flight.
 */
export type HeapState = {
  samples: HeapSample[];
  before: HeapSample | undefined;
  off: ReadingOffReason;
  pending: boolean;
};

/**
 * One telemetry attach: a watched, wired, linked device and everything read from it.
 */
export type AttachRecord = {
  readonly device: string;
  readonly serial: string;
  /** The device session's page without the hash (the CDP target); null without a session. */
  page: string | null;
  /** Set when the attach ended: every async step checks it before it goes on. */
  ended: boolean;
  /** An adb call (tick, meminfo or probe) in flight: a tick that finds it set is skipped. */
  busy: boolean;
  /** What the probe found; undefined until it ran, and again when a process vanished. */
  probe: Probe | undefined;
  /** Ticks in a row whose `/proc/<pid>/stat` was missing, by role. */
  missing: Map<ProcessRole, number>;
  /** The CPU counters of the last tick; undefined before the first (CPU warming up). */
  counters: CpuCounters | undefined;
  /** The last `dumpsys meminfo` readings. */
  memory: { app: Reading<ProcessMemory>; renderer: Reading<ProcessMemory> };
  /** Epoch ms of the last meminfo round; 0 before the first. */
  memoryAt: number;
  /** The CDP link while attached. */
  cdp: CdpLink | undefined;
  heap: HeapState;
  timers: {
    tick: ReturnType<typeof setInterval> | undefined;
    heap: ReturnType<typeof setInterval> | undefined;
  };
  /** The record of the last tick. */
  last: DeviceTelemetry | undefined;
};

/**
 * Connect state (spec 11 § 3 State). The api answers fresh copies, never these maps.
 */
export type ConnectState = {
  /** Device mode as connect sees it through hub:device; owner "connect" when connect turned it on. */
  mode: { on: boolean; owner: "connect" | "other" | null; listen: DeviceListen | null };
  /** adb availability from the last call: missing after a code-127 answer. Initially available. */
  adb: { available: boolean; reason: "missing" | "error" | undefined };
  /** Phones of the last `adb devices -l`, by serial, with their getprop facts and ready time. */
  wire: Map<string, WireRecord>;
  /** Pairings waiting for the person, FIFO (the hub asks one at a time). */
  asking: AskRecord[];
  /** End of the scan lease (epoch ms); 0 = none. */
  scanUntil: number;
  /**
   * Telemetry leases: device id → tools connection → end (epoch ms). A device stays attached while
   * one of its leases holds.
   */
  watches: Map<string, Map<number, number>>;
  /** Live attaches by device id. */
  attaches: Map<string, AttachRecord>;
  /** The last published directory (JSON text without `at`), to publish only on change. */
  published: string | undefined;
  /** Epoch ms of the last directory publish; 0 before the first. */
  publishedAt: number;
  /** Timers: the scan loop and the directory throttle. */
  timers: {
    scan: ReturnType<typeof setTimeout> | undefined;
    publish: ReturnType<typeof setTimeout> | undefined;
  };
  /** The scan round in flight, which a second caller awaits instead of starting another. */
  scanning: Promise<void> | undefined;
  /** The scan loop runs (a round in flight or the next one scheduled). */
  looping: boolean;
  /** Epoch ms device mode came on; undefined while it is off. */
  modeSince: number | undefined;
  /** A device-mode turn-on in flight, shared by calls that come meanwhile. */
  turning: Promise<DeviceListen> | undefined;
  /** adb forwards connect made: local port → serial. Only these are ever removed (A10). */
  forwards: Map<number, string>;
  /** The process, network and socket seams. */
  deps: ConnectDeps;
  /** Set by onStop: hooks and late callbacks do nothing after it. */
  stopped: boolean;
};

/**
 * connect's per-plugin events, visible to plugins that list `connectPlugin` in `depends`.
 */
export type ConnectEvents = { readonly "connect:telemetry": DeviceTelemetry };

/**
 * What `connect.watch` answers: whether wired telemetry runs for the device, and why not.
 *
 * @example
 * ```ts
 * const answer: WatchAnswer = { wired: false, reason: "not-wired" };
 * ```
 */
export type WatchAnswer = { readonly wired: boolean; readonly reason?: TelemetryOffReason };

/**
 * The connect api (`app.connect`). The tools page uses the editor methods `connect.*`; this api is
 * for the bin, tests and a later MCP tool.
 *
 * @example
 * ```ts
 * editor.connect.directory().mode.on; // false until a tools page asks for device mode
 * ```
 */
export type ConnectApi = {
  /**
   * The device directory as the tools page sees it: device mode, where a LAN pairing is confirmed,
   * adb's availability, the phones adb lists, the pairings asking (never their codes) and the
   * devices linked with their open sessions.
   *
   * @returns A fresh frozen copy, built now.
   * @example
   * ```ts
   * // After "By wire" in the Connect panel, with a Galaxy A26 on USB that paired.
   * editor.connect.directory().wire[0]; // { serial: "R5CX30ABCDE", state: "device", transport: "usb", model: "SM-A266B", name: "Galaxy A26", os: "Android 15", phase: "linked", device: "d-7f3a" }
   * ```
   */
  directory(): DeviceDirectory;
  /**
   * The newest wired telemetry of a linked device a tools page watches.
   *
   * @param device - A device id from hub.devices().
   * @returns The record of the last tick, undefined when the device is not attached.
   * @example
   * ```ts
   * // The Galaxy A26 is the source of a tools page: its Mali GPU at the bottom clock.
   * editor.connect.telemetry("d-7f3a")?.gpu; // { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 } }
   * ```
   */
  telemetry(device: string): DeviceTelemetry | undefined;
};

/**
 * The hooks of connect: hub's per-plugin `hub:device`.
 */
export type ConnectHooks = { readonly "hub:device": (event: HubDeviceEvent) => void };

/**
 * Domain context of connect: the kernel context is assignable to it.
 */
export type ConnectCtx = {
  readonly config: Readonly<ConnectConfig>;
  state: ConnectState;
  readonly emit: EmitFn<ConnectEvents>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * What the adb helper, the teardown and the forward removal need: the config and the state.
 */
export type ConnectCore = {
  readonly config: Readonly<ConnectConfig>;
  readonly state: ConnectState;
};
