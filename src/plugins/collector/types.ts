/**
 * @file collector plugin — type definitions: config, the adb seam and its readings, the per-log
 * sessions, the adb loop, state, the per-plugin event `collector:session` and its digest, the
 * wired telemetry line, the api, the hooks and the domain context. The report types of the runtime-free `./report` are re-exported
 * here, so the server entry's `Collector.*` namespace reaches them without a root export.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require } from "../../config";
import type { DeviceTelemetry } from "../connect/protocol";
import type { HubDeviceEvent, LinkedDevice } from "../hub/types";
import type { PerfCause } from "../perf/protocol";

export type {
  CompareRow,
  Comparison,
  Delta,
  FileLine,
  HeatSummary,
  HistPercentile,
  LogSummary,
  ParsedLog,
  PerfGapLine,
  ScreenSummary,
  SkippedLines,
  SystemSummary
} from "./report";

/**
 * Collector configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { collector: { out: "logs/perf", everyS: 5, appId: "com.example.garden" } } });
 * ```
 */
export type CollectorConfig = {
  /** Folder of the logs: relative to the files root, or absolute. Created on the first log. */
  out: string;
  /** Seconds between two adb readings (heat, system frames) of a phone. 1–3600. */
  everyS: number;
  /** Milliseconds between two `adb devices` + `adb reverse` rounds. ≥ 500. */
  reverseEveryMs: number;
  /** The adb command (a name on PATH or a path). */
  adb: string;
  /** The longest one adb command may run before it is killed. ≥ 500. */
  adbTimeoutMs: number;
  /**
   * The Android package of the game (its base identifier). The collector prefers `<appId>.debug` when
   * the phone has it (the debug build installs beside the store build), else `<appId>`. Undefined: no
   * gfx lines.
   */
  appId: string | undefined;
};

/**
 * What one adb command answered: its exit code (−1 when it was killed after `adbTimeoutMs`), its
 * standard output, and whether adb could not be spawned at all.
 *
 * @example
 * ```ts
 * const missing: AdbResult = { code: 127, text: "", missing: true };
 * ```
 */
export type AdbResult = { readonly code: number; readonly text: string; readonly missing: boolean };

/**
 * Runs one adb command: `runAdb` in the plugin, a fake in tests. Never rejects.
 *
 * @example
 * ```ts
 * const fake: AdbRunner = async (_command, args) => ({ code: 0, text: args[0] === "devices" ? "List of devices attached\n" : "", missing: false });
 * ```
 */
export type AdbRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<AdbResult>;

/**
 * The frames the system counted for an app since its process started (`dumpsys gfxinfo`).
 *
 * @example
 * ```ts
 * const totals: GfxTotals = { frames: 45230, janky: 10663, histogram: new Map([[5, 4171], [6, 807]]) };
 * ```
 */
export type GfxTotals = {
  /** `Total frames rendered`. */
  readonly frames: number;
  /** `Janky frames`. */
  readonly janky: number;
  /** Frames by their time in whole milliseconds. */
  readonly histogram: ReadonlyMap<number, number>;
};

/**
 * The frames of one stretch of time: the difference of two gfxinfo readings.
 *
 * @example
 * ```ts
 * const span: GfxSpan = { frames: 412, janky: 96, fps: 41.2, p50: 19, p90: 34, p99: 77, hist: [[16, 120], [19, 150]] };
 * ```
 */
export type GfxSpan = {
  readonly frames: number;
  readonly janky: number;
  /** Frames over the seconds of the stretch, one decimal. */
  readonly fps: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  /** `[milliseconds, count]` of the stretch. */
  readonly hist: readonly (readonly [number, number])[];
};

/**
 * The open file of a log, structurally (node's `FileHandle` in the plugin, a fake in tests).
 */
export type LogHandle = {
  /**
   * Appends text to the file.
   *
   * @param text - The lines, each ending in `\n`.
   * @returns When the text is written.
   */
  appendFile(text: string): Promise<void>;
  /**
   * Closes the file.
   *
   * @returns When it is closed.
   */
  close(): Promise<void>;
};

/**
 * The newest second of a device log, for a live line.
 *
 * @example
 * ```ts
 * const last: SessionDigest = { t: 5917.4, path: "garden/boss", fps: 118, loopFps: 120, p90Ms: 9.1, gpuMs: 4.8, rate: 120, spikes: 1, causes: ["upload"], thermal: { status: 1, batteryC: 36.1 }, model: "SM-A266B", backend: "webgpu", engine: "0.14.12+9c41e0", build: "debug-20261014T160000Z" };
 * ```
 */
export type SessionDigest = {
  /** Page epoch ms of the newest sample. */
  readonly t: number;
  /** Flow path of the newest sample. */
  readonly path: string;
  /** Frames drawn per second (whole number). */
  readonly fps: number;
  /** Loop frames per second (whole number). */
  readonly loopFps: number;
  /** p90 of the loop gap of the newest second (its `gapMs.p90`), null when not measured. */
  readonly p90Ms: number | null;
  /** p50 GPU ms of the newest second, null without a GPU timer. */
  readonly gpuMs: number | null;
  /**
   * The loop's rate in fps now (the newest `rate` event's `to`, else the header's `rate.fps`, else
   * `header.config.maxFps` when > 0); null when unknown.
   */
  readonly rate: number | null;
  /** Spikes of the newest second. */
  readonly spikes: number;
  /** Primary causes of the spikes of the last 6 s, most frequent first. */
  readonly causes: readonly PerfCause[];
  /** The newest heat reading (device shell or adb). */
  readonly thermal: {
    readonly status: number | string | null;
    readonly batteryC: number | null;
  } | null;
  readonly model: string;
  readonly backend: "webgpu" | "webgl" | "none" | null;
  readonly engine: string | null;
  readonly build: string | null;
};

/**
 * What the digest heard of a log besides its samples (header, rate events, heat), kept for the
 * next digest.
 */
export type DigestFacts = {
  /** The header's normalized model; null until a header names one. */
  model: string | null;
  backend: SessionDigest["backend"];
  engine: string | null;
  rate: number | null;
  thermal: SessionDigest["thermal"];
};

/**
 * One device log on the computer: one file.
 */
export type LogSession = {
  /** `${device.id}/${log}`. */
  readonly key: string;
  /** The newest copy from hub:device. */
  device: LinkedDevice;
  /** The device's log name. */
  readonly log: string;
  /** Absolute path of the computer file. */
  readonly file: string;
  /** Open while the device is connected; reopened in append mode. */
  handle: LogHandle | undefined;
  /** Writes of this log, in arrival order (each batch chains on the previous). Never rejects. */
  queue: Promise<void>;
  /** Lines written. */
  lines: number;
  /** Gaps + rejected + failed writes. */
  lost: number;
  /** A write failed and none succeeded since (one warning per streak). */
  failing: boolean;
  /** max(t − rx) over device lines: page clock minus computer clock, null before the first line with a t. */
  offset: number | null;
  /** Normalized model used in the file name and on collector lines. */
  model: string;
  /** From the header line, else the pairing. */
  build: string | null;
  state: "live" | "away" | "done";
  digest: SessionDigest | null;
  /** What the digest heard besides samples. */
  facts: DigestFacts;
  /** Primary causes of recent spikes: [page t, cause], at most 64. */
  recent: [number, PerfCause][];
  /** Computer ms of the last collector:session. */
  emittedAt: number;
  /** The trailing emit of the throttle. */
  emitTimer: ReturnType<typeof setTimeout> | undefined;
  /** onStop's flush bound (STOP_FLUSH_MS) ran out while this log's queue was still writing. */
  stopTimedOut: boolean;
  /** Bytes waiting in the queue (at most QUEUE_MAX_BYTES; a write beyond it is dropped). */
  queued: number;
  /** A write was dropped on a full queue and none was taken since (one warning per streak). */
  queueFull: boolean;
  /**
   * The device records this log: true from its first batch (a phone ships a log only while it
   * records, so a log first seen mid-recording counts), false after a `recorder` event line with
   * `action: "stop"`, true again after one with `action: "start"`. Wired telemetry is written into
   * the log only while it is true.
   */
  recording: boolean;
};

/**
 * The collector's computer-side line of a wired device's telemetry: one per `connect:telemetry`
 * tick while the device records, written only into the computer file (the phone's own log never
 * holds it). Editor-owned and additive to PerfLog v1, like `gap`. `serial`, `wired`, `gpu`, `cpu`,
 * `memory` and `heap` are the DeviceTelemetry fields verbatim: every reading keeps its `source`, or
 * its `reason` when it is not available, and `heap` holds every CDP sample and inferred GC of the
 * tick. `t` is the record's computer time on the log's page clock, through the log's offset (the
 * page clock is anchored once per log by the header's `timeOrigin`, `epochMs = timeOrigin + t`).
 *
 * @example
 * ```ts
 * const line: PerfTelemetryLine = { v: 1, kind: "telemetry", t: 5917.4, rx: 1791986084000, build: "debug-20261014T160000Z",
 *   device: "SM-A266B", serial: "R5CX30ABCDE", wired: true,
 *   gpu: { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 } },
 *   cpu: { cores: 8, app: { available: false, source: "none", reason: "not-found" },
 *     renderer: { available: false, source: "none", reason: "ambiguous" },
 *     surfaceflinger: { available: true, source: "/proc/612/stat", value: { pid: 612, name: "surfaceflinger", pct: 2.1, oneCorePct: 16.8 } } },
 *   memory: { app: { available: false, source: "dumpsys meminfo", reason: "warming-up" }, renderer: { available: false, source: "dumpsys meminfo", reason: "warming-up" } },
 *   heap: { available: false, source: "none", reason: "no-devtools-socket" } };
 * ```
 */
export type PerfTelemetryLine = {
  readonly v: 1;
  readonly kind: "telemetry";
  /** The record's `at` on the log's page clock (`at + offset`, 0.01 ms); `rx` while the log has no offset. */
  readonly t: number;
  /** Computer epoch ms when the collector wrote it. */
  readonly rx: number;
  /** The log's build. */
  readonly build: string | null;
  /** The log's normalized model. */
  readonly device: string;
  readonly serial: DeviceTelemetry["serial"];
  readonly wired: DeviceTelemetry["wired"];
  readonly gpu: DeviceTelemetry["gpu"];
  readonly cpu: DeviceTelemetry["cpu"];
  readonly memory: DeviceTelemetry["memory"];
  readonly heap: DeviceTelemetry["heap"];
};

/**
 * What the adb loop knows of one phone.
 */
export type AdbPhone = {
  readonly serial: string;
  /** getprop ro.product.model, normalized; null until read. */
  model: string | null;
  reversed: boolean;
  /** The resolved app package, re-read after 60 s. */
  package: { name: string | null; at: number } | undefined;
  /** The previous gfxinfo reading. */
  gfx: { totals: GfxTotals; at: number } | undefined;
};

/**
 * The adb loop while device mode is on.
 */
export type AdbLoop = {
  readonly port: number;
  phones: Map<string, AdbPhone>;
  reverseTimer: ReturnType<typeof setInterval>;
  pollTimer: ReturnType<typeof setInterval>;
  /** A reverse round runs: the next tick is skipped. */
  reversing: boolean;
  /** A poll round runs: the next tick is skipped. */
  polling: boolean;
  /** "missing": adb could not be spawned; the loop stopped itself. */
  state: "on" | "missing";
  /** One warning per serial and kind (and one ambiguity line per model). */
  warned: Set<string>;
};

/**
 * Collector state (the api returns copies, never these maps).
 */
export type CollectorState = {
  sessions: Map<string, LogSession>;
  /** Connected now, by hub device id. */
  devices: Map<string, LinkedDevice>;
  /** Undefined while device mode is off. */
  adb: AdbLoop | undefined;
  /** The absolute out folder, resolved on the first log. */
  outDir: string | undefined;
  /** onStop ran: a later hub:device is ignored and nothing is emitted. */
  stopped: boolean;
  /**
   * Lines refused per device id because the device already had MAX_LIVE_LOGS live logs; the first
   * refusal of a device is warned (`collector:log-cap`).
   */
  refused: Map<string, number>;
};

/**
 * Payload of the collector's per-plugin event `collector:session`.
 *
 * @example
 * ```ts
 * ctx.emit("collector:session", { device, file: "/game/.moku/perf/perf-20261014-1532-sm-a266b.jsonl", state: "live", lines: 1840, lost: 0, last: null });
 * ```
 */
export type CollectorSessionEvent = {
  readonly device: LinkedDevice;
  readonly file: string;
  /** live: the phone is connected; away: it left and may come back; done: device mode stopped. */
  readonly state: "live" | "away" | "done";
  readonly lines: number;
  readonly lost: number;
  readonly last: SessionDigest | null;
};

/**
 * The collector's per-plugin events, visible to plugins that list `collectorPlugin` in `depends`.
 */
export type CollectorEvents = { readonly "collector:session": CollectorSessionEvent };

/**
 * A log as the API reports it (fresh copy).
 *
 * @example
 * ```ts
 * const info: CollectorSessionInfo = { device, log: "perf-20261014-1532-sm-a266b.jsonl", file: "/game/.moku/perf/perf-20261014-1532-sm-a266b.jsonl", state: "done", lines: 1840, lost: 0, last: null, stopTimedOut: false };
 * ```
 */
export type CollectorSessionInfo = {
  readonly device: LinkedDevice;
  readonly log: string;
  readonly file: string;
  readonly state: "live" | "away" | "done";
  readonly lines: number;
  readonly lost: number;
  readonly last: SessionDigest | null;
  /**
   * True when the app stopped while this log was still being written (onStop's 2 s bound ran out);
   * its last lines may be missing from the file. False otherwise.
   */
  readonly stopTimedOut: boolean;
};

/**
 * What the adb loop sees now.
 *
 * @example
 * ```ts
 * const status: AdbStatus = { state: "on", phones: [{ serial: "R5CX30ABCDE", model: "SM-A266B", reversed: true }] };
 * ```
 */
export type AdbStatus = {
  readonly state: "off" | "on" | "missing";
  readonly phones: readonly {
    readonly serial: string;
    readonly model: string | null;
    readonly reversed: boolean;
  }[];
};

/**
 * The collector api (`app.collector`, `ctx.require(collectorPlugin)`).
 *
 * @example
 * ```ts
 * await editor.collector.mark("boss"); // 1
 * ```
 */
export type CollectorApi = {
  /**
   * Every device log of this run, oldest first, as fresh copies. Still answers after `stop()`: a
   * log whose writes outlived onStop's 2 s flush bound carries `stopTimedOut: true` (teardown
   * cannot log it, so this is where it shows).
   *
   * @returns The logs; [] before any phone sent a line.
   * @example
   * ```ts
   * // The perf command, after Ctrl+C, prints the summary of each file written in this run.
   * editor.collector.sessions().map(session => session.file);
   * // ["/game/.moku/perf/perf-20261014-1532-sm-a266b.jsonl"]
   * ```
   */
  sessions(): CollectorSessionInfo[];

  /**
   * Writes a mark from the computer into every live log: `{ v: 1, kind: "mark", t, build, rx,
   * label, auto: false, from: "computer" }`, with `t` on that log's page clock. The label is
   * trimmed.
   *
   * @param label - 1–200 characters after trimming.
   * @returns How many logs got the mark (0 when no phone is live).
   * @throws {TypeError} `[moku-editor] collector.mark: the label must be 1-200 characters.` with the
   * fix `Give a short name, for example "boss".` for an empty or long label.
   * @example
   * ```ts
   * // `moku-editor perf mark "boss"` reaches this through the mark route.
   * await editor.collector.mark("boss"); // 1
   * ```
   */
  mark(label: string): Promise<number>;

  /**
   * The adb loop now: off while device mode is off, missing when adb could not run, else the
   * phones it sees.
   *
   * @returns A fresh status.
   * @example
   * ```ts
   * // The perf command names the phones whose port it reversed.
   * editor.collector.adb(); // { state: "on", phones: [{ serial: "R5CX30ABCDE", model: "SM-A266B", reversed: true }] }
   * ```
   */
  adb(): AdbStatus;

  /**
   * Resolves when every step queued on a log before the call is done: its writes, the close of
   * its file and the `collector:session` that follows. After `hub.stopDevices()` that is every
   * log's `done` event, which the collector emits from the log's queue a few ticks after the hub's
   * `stopped`. Resolves at once when nothing is pending.
   *
   * @returns When the logs' queues have drained.
   * @example
   * ```ts
   * // The perf command's Ctrl+C: device mode off, every done line printed, then the editor stops.
   * await editor.hub.stopDevices();
   * await editor.collector.settled(); // each log's collector:session { state: "done" } went out
   * await editor.stop();
   * ```
   */
  settled(): Promise<void>;
};

/**
 * The hooks of the collector: the hub's per-plugin event `hub:device` and connect's per-plugin
 * event `connect:telemetry` (both seen through `depends`).
 */
export type CollectorHooks = {
  readonly "hub:device": (event: HubDeviceEvent) => void;
  readonly "connect:telemetry": (record: DeviceTelemetry) => void;
};

/**
 * Domain context of the collector: the kernel context is assignable to it.
 */
export type CollectorCtx = {
  readonly config: Readonly<CollectorConfig>;
  state: CollectorState;
  readonly emit: EmitFn<CollectorEvents>;
  readonly log: Log.LogApi;
  readonly require: Require;
};
