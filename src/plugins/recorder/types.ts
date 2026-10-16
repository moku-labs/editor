/**
 * @file recorder plugin — type definitions: the config, the log and outbox shapes, the per-plugin
 * event, the state, the contexts the domain files take and the API (its contract and examples live
 * here, on the members).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { AgentEvents, Require } from "../../config";
import type {
  MonitorLike,
  PerfEventLine,
  PerfHeaderLine,
  PerfLogLine,
  PerfStartupLine
} from "../perf/protocol";
import type { Json } from "../registry/protocol";
import type { RegistryCommandEvent } from "../registry/types";
import type { LogMark, RecorderStatus, RecorderStatusEvent } from "./protocol";
import type { LogStore } from "./store/types";

export type {
  LogMark,
  MarkInput,
  RecorderSource,
  RecorderStatus,
  RecorderStatusEvent,
  RecordOrigin,
  RecordStarter
} from "./protocol";

/**
 * recorder configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, recorder: { autoStart: true, maxLogMb: 16 } } });
 * ```
 */
export type RecorderConfig = {
  /**
   * Start a log when the plugin starts. "device": only on a debug build (agent flag on, dev flag
   * off), the build that is for measuring; a dev page records only when asked. true: always;
   * false: never. "device".
   */
  autoStart: boolean | "device";
  /** Most MB kept in memory: lines the computer has not confirmed, plus the logs of the memory store. 64. 1 to 512. */
  keepMb: number;
  /** How often the queue is serialized, ms: 1000. 100 to 10000. */
  flushEveryMs: number;
  /** How often serialized text is written to the store, ms: 5000; also when 64 KB wait, and at stop. 1000 to 60000. */
  persistEveryMs: number;
  /** "auto": OPFS when the page has it, memory otherwise; "memory": never on disk. */
  storage: "auto" | "memory";
  /** Finished logs kept in the store; the oldest beyond are removed when a log starts. 10. 1 to 100. */
  keepFiles: number;
  /**
   * The size of one log, MB: at it the recorder rotates (finishes the log and goes on in a new one
   * with the same label). 32 (the native share's cap, so every log stays shareable). Whole, 1 to 512.
   */
  maxLogMb: number;
};

/**
 * One log as the recorder lists it.
 *
 * @example
 * ```ts
 * const file: LogFileInfo = { name: "perf-20261014-1402-sm-a266b.jsonl", label: "garden, A26",
 *   startedAt: 1792000920000, lines: 9_840, bytes: 2_202_009, sent: 9_840, current: false, storage: "opfs" };
 * ```
 */
export type LogFileInfo = {
  readonly name: string;
  readonly label: string | null;
  /** Epoch ms of the start. */
  readonly startedAt: number;
  readonly lines: number;
  /** UTF-8 bytes of the text plus one per newline: the size of the file. */
  readonly bytes: number;
  /** Lines of this log the computer confirmed (`ack`). */
  readonly sent: number;
  /** The log being recorded now. */
  readonly current: boolean;
  readonly storage: "opfs" | "memory";
};

/**
 * One run of the outbox: the oldest unconfirmed lines of one log, as the bridge sends them in
 * `perf.lines` (spec 01 C8 `PerfLinesParams`). `lines` are the JSON texts the flush already made,
 * one complete object each; the bridge splices them into the message, so the hub receives objects.
 *
 * @example
 * ```ts
 * const run: OutboxRun = { log: "perf-20261014-1532-sm-a266b.jsonl", from: 1790, lines: ['{"v":1,"kind":"mark","t":64000.5,"build":"debug-20261014T160000Z","label":"boss","auto":false}'] };
 * ```
 */
export type OutboxRun = {
  /** The log's file name (the hub's `log`). */
  readonly log: string;
  /** Index of `lines[0]` within that log, 0-based, counted when the line was serialized. */
  readonly from: number;
  readonly lines: readonly string[];
};

/**
 * What `share` did.
 *
 * @example
 * ```ts
 * const how: ShareResult = "downloaded";
 * ```
 */
export type ShareResult = "shared" | "cancelled" | "downloaded";

/**
 * The recorder's own events: declared in its `index.ts`, hooked through `depends` (not in
 * `AgentEvents`).
 */
export type RecorderEvents = { readonly "recorder:status": RecorderStatusEvent };

/**
 * The current log (private).
 */
export type Session = {
  readonly name: string;
  readonly label: string | null;
  readonly startedAt: number;
  lines: number;
  bytes: number;
  sent: number;
  /** Serialized lines not yet in the store, and their size. */
  pending: string[];
  pendingBytes: number;
  lastPersistAt: number;
  /** Chunks this log wrote to its store. */
  chunks: number;
  /** Where the log is written: the recorder's store, or memory after three failed writes. */
  store: LogStore;
  /** The write in flight; one at a time, so the chunks keep their order. */
  inflight: Promise<unknown> | undefined;
  /** The tick's drain stopped before a line that would carry the log past maxLogMb: it rotates. */
  full: boolean;
  /** The hard cap of this log in UTF-8 bytes (maxLogMb when it started): a stop never passes it. */
  readonly capBytes: number;
};

/**
 * recorder state (private). The queue is allocated once.
 */
export type RecorderState = {
  /** perf.monitor(), read in onInit; undefined → nothing to record. */
  monitor: MonitorLike | undefined;
  unsubscribe: (() => void) | undefined;
  timer: ReturnType<typeof setInterval> | undefined;
  /** Line references waiting for the timer: a ring of QUEUE_LINES (4096) slots. */
  readonly queue: (PerfLogLine | undefined)[];
  queueHead: number;
  queueSize: number;
  /** The newest context lines, written at every log start. */
  header: PerfHeaderLine | undefined;
  startup: PerfStartupLine | undefined;
  display: PerfEventLine | undefined;
  /** The current log; undefined while idle. */
  session: Session | undefined;
  /** The last finished log's numbers, for status() while idle. */
  last: LogFileInfo | undefined;
  phase: "idle" | "recording" | "exporting";
  /** Where new logs go: OPFS once onStart opened it, else `memory`. */
  store: LogStore;
  /** The memory store: the store itself without OPFS, and the home of a log moved off OPFS. */
  readonly memory: LogStore;
  /** Every log the store holds, oldest first; the current one last. */
  files: LogFileInfo[];
  /**
   * Every name this recorder gave a log in this run, the pruned ones too: a new log never takes one
   * (the computer keys a phone's logs by name, so a reused name would make the new log's lines look
   * like the old log's). One short string per log started.
   */
  readonly named: Set<string>;
  /** Marks of the current (or last) log. */
  marks: LogMark[];
  /**
   * The outbox: serialized lines not yet confirmed, oldest first from outboxHead, the log each
   * belongs to and its index within that log.
   */
  outbox: string[];
  outboxOwner: string[];
  outboxIndex: number[];
  outboxHead: number;
  outboxBytes: number;
  sent: number;
  dropped: number;
  /** `dropped` at the end of the last flush tick: a tick that ends higher continues or opens a drop streak. */
  droppedTick: number;
  /** A drop streak is open: the next drop logs nothing. */
  dropping: boolean;
  /**
   * Ticks autoStart still waits for the header a native shell holds back (0: none pending): a tick
   * with the header, or the last one, starts the log.
   */
  autoStartWait: number;
  /** Shares in flight: the phase is `exporting` while one runs. */
  exports: number;
  /** The last status emitted, to emit only on change. */
  emitted: RecorderStatusEvent | undefined;
  /** Watches of the editor.recorder source: called wherever recorder:status is emitted. */
  readonly watchers: Set<() => void>;
  /** A watch threw in the last round of calls: the next throw logs nothing. */
  watchFailing: boolean;
  /** Consecutive persist failures of the current log. */
  failures: number;
  /**
   * Logs moved to memory after their store failed: the store that keeps their earlier chunks. Read
   * and remove take both parts.
   */
  readonly heads: Map<string, LogStore>;
  /** The revoke timers of download URLs, and their URLs: revoked at once at stop. */
  readonly revokes: Map<ReturnType<typeof setTimeout>, string>;
  /**
   * Logs being finished (a stop or a rotation), by name, until the finish settled: a remove or a
   * share of that log waits for it, and onStop waits for all.
   */
  readonly finishing: Map<string, Promise<void>>;
};

/**
 * The context the recorder's domain files take: the kernel context is assignable to it. `emit`
 * sends the recorder's own `recorder:status`.
 */
export type RecorderCtx = {
  readonly config: Readonly<RecorderConfig>;
  state: RecorderState;
  readonly emit: EmitFn<RecorderEvents>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The teardown context of the recorder's onStop: own config and state, no emit, no log.
 */
export type RecorderStopCtx = {
  readonly config: Readonly<RecorderConfig>;
  state: RecorderState;
};

/**
 * The hooks of the recorder: the overlay's global `overlay:changed` and the registry's per-plugin
 * `registry:command`.
 */
export type RecorderHooks = {
  readonly "overlay:changed": (event: AgentEvents["overlay:changed"]) => void;
  readonly "registry:command": (event: RegistryCommandEvent) => void;
};

/**
 * The recorder API (`app.recorder`, `ctx.require(recorderPlugin)`): the performance log on the
 * device for the overlay's Record tab, and its outbox for the bridge.
 */
export type RecorderApi = {
  /**
   * Starts a log: writes the context lines (header, startup, newest display) and a `recorder` start
   * event, then every line of the stream until `stop`. While a log runs it answers that log and
   * changes nothing. Removes the oldest finished logs beyond `keepFiles`.
   *
   * @param options - How to start.
   * @param options.label - A name for this run, written into the start event and the file list
   *   (trimmed; empty is no label).
   * @returns The new (or running) log.
   * @throws {Error} `[moku-editor] recorder.start: this game has no performance monitor.\n  Run a dev or debug build
   *   of `@moku-labs/game` with the monitor (block 2b).` when perf found none (a lifecycle error).
   * @example
   * ```ts
   * // A tester starts a run on the phone before the boss.
   * app.recorder.start({ label: "garden, A26" }); // { name: "perf-20261014-1532-sm-a266b.jsonl", current: true, lines: 0, … }
   * ```
   */
  start(options?: { readonly label?: string }): LogFileInfo;
  /**
   * Stops the log: writes the `recorder` stop event, serializes what is queued, writes everything to
   * the store and marks the log finished. When the store fails, the log stays in memory and
   * `recorder:persist-failed` warns.
   *
   * @returns The finished log; undefined when no log was running.
   * @example
   * ```ts
   * const file = await app.recorder.stop(); // { name: "perf-20261014-1532-sm-a266b.jsonl", lines: 1840, bytes: 412_000, current: false, … }
   * ```
   */
  stop(): Promise<LogFileInfo | undefined>;
  /**
   * Writes a mark into the log through the engine (`monitor.mark`), so what follows has a name, and
   * adds it to the marks of the current log.
   *
   * @param label - What follows: "boss enters".
   * @returns True when a log is running and the mark went into it; false while idle, without a
   *   monitor or for an empty label (nothing written).
   * @example
   * ```ts
   * app.recorder.mark("boss enters"); // true; marks() ends with { atMs: 64_000, label: "boss enters", auto: false }
   * ```
   */
  mark(label: string): boolean;
  /**
   * Adds the automatic mark of a game command the overlay ran: while recording, a `mark` line with
   * `label` through the engine (`monitor.mark`) and `{ atMs, label, auto: true, command: { id, input } }`
   * in `marks()`. It writes no `command` event: the registry's `registry:command` (via "overlay")
   * already made the recorder log the run once. Called by the overlay after a press resolved.
   *
   * @param id - The command id.
   * @param input - The input it ran with.
   * @param label - The mark's words, e.g. "Glow off".
   * @returns True when a log is running and the mark went into it; false while idle or without a monitor.
   * @example
   * ```ts
   * // overlay, after the "Glow" toggle ran with { on: false }:
   * ctx.require(recorderPlugin).command("garden.glow", { on: false }, "Glow off"); // true; marks() ends with the auto mark
   * ```
   */
  command(id: string, input: Json, label: string): boolean;
  /**
   * The state of the log and the outbox, for the Record tab.
   *
   * @returns A fresh RecorderStatus.
   * @example
   * ```ts
   * app.recorder.status().pending; // 50: lines the computer has not confirmed yet
   * ```
   */
  status(): RecorderStatus;
  /**
   * The marks of the current log, or of the last one while idle, in time order.
   *
   * @returns A copy.
   * @example
   * ```ts
   * app.recorder.marks(); // [{ atMs: 64_000, label: "boss enters", auto: false }, { atMs: 150_000, label: "Glow off", auto: true, … }]
   * ```
   */
  marks(): readonly LogMark[];
  /**
   * The logs on this device, oldest first, the current one last. A log a page left "current" when it
   * died lists as finished.
   *
   * @returns A copy.
   * @example
   * ```ts
   * app.recorder.files().map(file => file.name); // ["perf-20261014-1402-sm-a266b.jsonl", "perf-20261014-1532-sm-a266b.jsonl"]
   * ```
   */
  files(): readonly LogFileInfo[];
  /**
   * Hands a log to the user: the native share sheet when the shell offers `share`, else a download
   * link (works in a browser, not in a WebView). The current log is written to the store first, so
   * the shared file has every line so far. The status shows `exporting` meanwhile.
   *
   * @param name - The log's file name.
   * @returns "shared" or "cancelled" (share sheet), or "downloaded".
   * @throws {TypeError} For an unknown name (argument validation).
   * @throws {Error} When the page has neither a document nor a native share.
   * @example
   * ```ts
   * await app.recorder.share("perf-20261014-1402-sm-a266b.jsonl"); // "shared" on the phone
   * ```
   */
  share(name: string): Promise<ShareResult>;
  /**
   * Removes a finished log from the device.
   *
   * @param name - The log's file name.
   * @throws {TypeError} For an unknown name (argument validation).
   * @throws {Error} For the log being recorded (stop it first).
   * @example
   * ```ts
   * await app.recorder.remove("perf-20261014-1402-sm-a266b.jsonl");
   * app.recorder.files().length; // 1
   * ```
   */
  remove(name: string): Promise<void>;
  /**
   * The oldest unconfirmed lines of **one** log (the log of the outbox's oldest line), without taking
   * them: the bridge sends them as `perf.lines { log, from, lines }` and confirms with `ack(log, next)`.
   * A peek, so a lost connection needs nothing: after a reconnect the same run is answered again, and
   * the hub drops what it already has by index. Lines the recorder dropped under `keepMb` leave a jump
   * in the index, which the hub reports as a gap (spec 01 C5).
   *
   * @param max - Most lines to answer (a whole number ≥ 1; anything else counts as 1).
   * @returns The run, a fresh object; undefined when the outbox is empty.
   * @example
   * ```ts
   * // bridge, with 50 lines of the current log pending:
   * recorder.unsentRun(200); // { log: "perf-20261014-1532-sm-a266b.jsonl", from: 1790, lines: [ …50 JSON texts ] }
   * ```
   */
  unsentRun(max: number): OutboxRun | undefined;
  /**
   * Confirms every outbox line of `log` whose index is below `next`: the hub took them (its
   * `perf.ack { log, next }`). They leave the outbox and count as sent (for their log and in status).
   * Idempotent and monotonic: an older or repeated ack removes nothing more; an unknown log changes
   * nothing. The status event follows on the next flush tick.
   *
   * @param log - The log's file name, as `unsentRun` gave it.
   * @param next - The hub's next expected index of that log.
   * @throws {TypeError} When `next` is not a whole number from 0 (argument validation).
   * @example
   * ```ts
   * // bridge, after the hub answered { log, next: 1840, n: 50 }:
   * recorder.ack("perf-20261014-1532-sm-a266b.jsonl", 1840);
   * recorder.status().pending; // 0
   * ```
   */
  ack(log: string, next: number): void;
};
