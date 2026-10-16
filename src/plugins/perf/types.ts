/**
 * @file perf plugin — type definitions: the config, the state, the context the domain files take,
 * the API (its contract and examples live here, on the members) and the wire types of ./protocol
 * re-exported for consumers of `Perf.*`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { GameLike } from "../registry/types";
import type {
  FrameRing,
  MonitorLike,
  MonitorSections,
  PassColumnsNext,
  PerfCaps,
  PerfDisplay,
  PerfEventLine,
  PerfHeaderLine,
  PerfHeaderNext,
  PerfMarkLine,
  PerfOffReason,
  PerfPassesLine,
  PerfPassesWire,
  PerfSampleLine,
  PerfSampleNext,
  PerfSecond,
  PerfSpikeLine,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfStatus,
  PerfWindow,
  PerfWindowView,
  TimelineEventLine
} from "./protocol";

export type {
  MonitorLike,
  PerfFrameEvent,
  PerfLogLine,
  PerfOffReason,
  PerfRate,
  PerfRenderStats,
  PerfSecond,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfStatus,
  PerfWindow,
  PerfWindowView,
  PerfWindowWire
} from "./protocol";

/**
 * perf configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, perf: { windowMs: 10_000, frames: 2048 } } });
 * ```
 */
export type PerfConfig = {
  /** How often perf reads the ring, ms: 250 (4 Hz; the overlay never repaints faster). 50 to 1000. */
  readEveryMs: number;
  /** The window the graph, the spike index and every spike count cover, ms: 6000. 1000 to 30000. */
  windowMs: number;
  /** Rows perf keeps: at least windowMs at the fastest display (720 at 120 Hz). 1024. 64 to 16384. */
  frames: number;
  /**
   * Read the engine's pass ring and send the pass rows (`feeds.passes`): false, as the engine's
   * `passes` section. Flat, not a nested `feeds` object: per-plugin config merges shallowly.
   */
  feedPasses: boolean;
  /** Read and send the top 5 systems of each frame (`feeds.systems`): true. */
  feedSystems: boolean;
  /** Read and send the demand marks of each frame (`feeds.nodes`): false. */
  feedNodes: boolean;
};

/**
 * What perf itself reads and sends: the three feed switches, set from the flat config and switched
 * by `editor.perf.sections`.
 */
export type PerfFeedSwitches = { passes: boolean; systems: boolean; nodes: boolean };

/**
 * The pass ring as perf reads it: the engine's columns and, from the 0.15.x patch, the owner, the
 * filter kind (`kind2`, 1-based into `kindNames`), the draw counter, the format and the resolution.
 */
export type PassRing = FrameRing["passes"] & PassColumnsNext;

/**
 * The member of the engine's next change perf calls when the monitor has it (TC §2.7):
 * `sections(next?)`. Absent from 0.15.x. (`monitor.detail`, N5, is not called yet: its reading is
 * deferred to the engine's next change, owner 2026-10-16.)
 */
export type MonitorNext = {
  readonly sections?: (next?: Partial<MonitorSections>) => MonitorSections;
};

/**
 * What perf hands the wire for `editor.perf.passes`: the wire value with the engine's `passes` line
 * as the engine froze it (readonly arrays); `toWireValue` copies it into `PerfPassesWire`.
 */
export type PassesAnswer = Omit<PerfPassesWire, "line"> & { readonly line: PerfPassesLine | null };

/**
 * A line the timeline keeps by reference: an event of a name it marks, or a mark.
 */
export type TimelineLine = TimelineEventLine | PerfMarkLine;

/**
 * The frame ring as perf reads it: the engine's, with the system names (public from the 0.15.x
 * patch, present before it).
 */
export type NamedRing = FrameRing & { readonly systemNames?: readonly string[] };

/**
 * The pass window (spec 03 Delta 2026-10-16 D5): the pass ring copied with perf's own cursor,
 * struct-of-arrays, `config.frames × 4` rows in ring order, trimmed with the frame window. The
 * 0.15.x columns are allocated once, when the capabilities first say the ring has them.
 */
export type PassWindow = {
  readonly capacity: number;
  count: number;
  /** The ring index k of each pass (its slot is `k % capacity`), for the late GPU time. */
  readonly seq: Float64Array;
  readonly frame: Uint32Array;
  readonly index: Uint8Array;
  /** The ring's kind byte (`passKindOf`). */
  readonly kind: Uint8Array;
  readonly w: Uint16Array;
  readonly h: Uint16Array;
  /** NaN while not measured. */
  readonly gpuMs: Float32Array;
  /** The label (the view), by reference. */
  readonly label: (string | null)[];
  owner: Uint32Array | undefined;
  /** The raw `kind2` byte: 0 none, else `kindNames[kind2 - 1]`. */
  filter: Uint8Array | undefined;
  drawsAt: Uint16Array | undefined;
  format: (string | null)[] | undefined;
  resolution: Float32Array | undefined;
};

/**
 * The read target of a tick: the ring columns perf copies, each `length` long. Assignable to the
 * engine's `FrameReadout`.
 */
export type PerfScratch = {
  readonly length: number;
  readonly frame: Uint32Array;
  readonly t: Float64Array;
  readonly gapMs: Float32Array;
  readonly capMs: Float32Array;
  readonly rateMs: Float32Array;
  /** Filled with NaN at creation: a ring without the column (an engine before the addendum) leaves it so. */
  readonly budgetMs: Float32Array;
  readonly workMs: Float32Array;
  readonly agentMs: Float32Array;
  readonly gpuMs: Float32Array;
  readonly gpuPartial: Uint8Array;
  readonly drawn: Uint8Array;
  /** The frame ran under the idle cap (time's `idle`). */
  readonly idle: Uint8Array;
  /** The draw reason of spec 14 (an index of the engine's `DEMAND_REASONS`; `REASON_NONE` = on demand, nothing drawn). */
  readonly reason: Uint8Array;
  readonly causes: Uint8Array;
  readonly path: Uint16Array;
  /** Draw calls (NaN: not counted, WebGL). */
  readonly draws: Float32Array;
  /** `length × 5`: the five slowest systems (`0xffff` empty); read only while `feeds.systems`. */
  readonly sysIdx: Uint16Array;
  readonly sysMs: Float32Array;
  /** Demand marks (NaN: not measured); read only while `feeds.nodes`. */
  readonly marks: Float32Array;
};

/**
 * One read target of the ring: the scratch's columns, with or without the systems and the marks.
 * Four are made once with the state, one per combination of the two feeds.
 */
export type PerfReadout = Omit<PerfScratch, "sysIdx" | "sysMs" | "marks"> &
  Partial<Pick<PerfScratch, "sysIdx" | "sysMs" | "marks">>;

/**
 * A sample line as perf reads it: the engine's, with the fields of the 0.15.x patch and the next
 * change (`counts`, `targets`, `shaders`, `sectionsMs`, `memory`) when the engine sends them.
 */
export type SampleLine = PerfSampleLine & PerfSampleNext;

/**
 * A header line as perf reads it: the engine's, with the app id, the overdraw flag and the sections
 * of the 0.15.x patch and the next change when the engine sends them.
 */
export type HeaderLine = PerfHeaderLine & PerfHeaderNext;

/**
 * perf state (private; created once, arrays allocated once).
 */
export type PerfState = {
  /** The game the registry wraps, found in onInit (stats() is read from its renderer). */
  game: GameLike | undefined;
  /** The engine monitor, found in onInit (with the next change's members when it has them); undefined → off. */
  monitor: (MonitorLike & MonitorNext) | undefined;
  /** Why there is no monitor; undefined with one. */
  off: PerfOffReason | undefined;
  /** The ring had capacity > 0 at the last read. */
  measuring: boolean;
  /** The window the API and the sources hand out. */
  readonly window: PerfWindow;
  /** Per window row: the ring index k of the frame (slot = k % capacity). */
  readonly rowWritten: Float64Array;
  /** Per window row: the GPU time may still change. */
  readonly rowPartial: Uint8Array;
  /** Per window row: the gap before the frame; NaN for none. */
  readonly rowGapMs: Float32Array;
  /** Per window row: the path id (ring.paths). */
  readonly rowPath: Uint16Array;
  /** The read target, `config.frames` long. */
  readonly scratch: PerfScratch;
  /**
   * Page-clock ms of the first frame of the current rest: set when a row turns idle after a row that
   * was not, kept while the rows stay idle (the window's trims do not move it), cleared by the next
   * row that is not idle. Undefined while awake.
   */
  idleSinceT: number | undefined;
  /** The p90 frame time of the window's awake frames at the last read that had one, ms; NaN before. */
  awakeP90Ms: number;
  /** ring.written after the last read; undefined before the first read of a run. */
  cursor: number | undefined;
  /** Frames the ring overwrote before perf read them, since start. */
  lost: number;
  /** Frames of the last 1000 ms of the window: run by the loop. */
  fpsLoop: number;
  /** Frames of the last 1000 ms of the window: drawn. */
  fpsDrawn: number;
  /** The newest header line (a frozen engine object, kept by reference). */
  header: HeaderLine | undefined;
  /** header.display, replaced by every valid `display` event. */
  display: PerfDisplay | undefined;
  /** The newest sample line. */
  sample: SampleLine | undefined;
  /**
   * The display's refresh rate: the `hz` the display announces (header or newest `display` event),
   * else the engine's `time.rate().displayHz`, else the header's or newest rate line's; null while
   * unknown.
   */
  displayHz: number | null;
  /** The last 64 spike lines by arrival. */
  readonly spikeLines: (PerfSpikeLine | undefined)[];
  /** Spike lines received; the next slot is `spikeLineNext % 64`. */
  spikeLineNext: number;
  /** The last 16 `rate` event lines by arrival. */
  readonly rateLines: (PerfEventLine | undefined)[];
  /** Rate lines received; the next slot is `rateLineNext % 16`. */
  rateLineNext: number;
  /** The last 32 frame-event lines of the game (`overlay`, `pool-trim`, `warm`) by arrival. */
  readonly frameEvents: (PerfEventLine | undefined)[];
  /** Frame-event lines received; the next slot is `frameEventNext % 32`. */
  frameEventNext: number;
  /** The read timer while started. */
  timer: ReturnType<typeof setInterval> | undefined;
  /** The stream unsubscribe while started. */
  unsubscribe: (() => void) | undefined;
  /** Source watches: called after each read that changed the window, and after a new sample or rate line. */
  readonly watchers: Set<() => void>;
  /** Calls one watcher, isolated: a throw is caught and warned once per streak. Made once with the state. */
  readonly callWatcher: (watcher: () => void) => void;
  /** perf's log, set in onInit: the `perf:watcher-failed` warning goes here. */
  log: Pick<Log.LogApi, "warn"> | undefined;
  /** A watcher threw in the notify round now running. */
  watchFailed: boolean;
  /** The last notify round had a failure: the warning of this streak was given. */
  watchStreak: boolean;
  /** second() of the current window version and lines, built on demand. */
  second: PerfSecond | undefined;

  // Mission control (spec 03 Delta 2026-10-16).

  /** The read targets, by `(systems ? 1 : 0) | (marks ? 2 : 0)`; made once. */
  readonly readouts: readonly [PerfReadout, PerfReadout, PerfReadout, PerfReadout];
  /** What the read now running copies besides the base columns: 1 the systems, 2 the marks. */
  readMask: number;
  /** Per window row: draw calls (NaN: not counted). */
  readonly rowDraws: Float32Array;
  /** Per window row × 5: the five slowest systems' name index, −1 none (or not read). */
  readonly rowSysIdx: Int16Array;
  /** Per window row × 5: their ms. */
  readonly rowSysMs: Float32Array;
  /** Per window row: demand marks; NaN while not measured or not read. */
  readonly rowMarks: Float32Array;
  /** What the engine and the build measure (D2); recomputed at the read after a new header. */
  caps: PerfCaps;
  /** A header arrived (or perf started) since the capabilities were computed. */
  capsStale: boolean;
  /** What perf reads and sends: from the flat config, switched by `editor.perf.sections`. */
  readonly feeds: PerfFeedSwitches;
  /** The engine's sections as last heard (header, the start read, a `sections` line, a write); undefined before. */
  sections: MonitorSections | undefined;
  /** The overdraw heat map is on (header `debug`, `debug` lines); null while the engine has not said. */
  overdraw: boolean | null;
  /** The pass window. */
  readonly passes: PassWindow;
  /** The pass ring's `written` after the last pass read; undefined before it (and after a switch-on). */
  passCursor: number | undefined;
  /** Passes the ring overwrote before perf read them, since start. */
  passesLost: number;
  /** The timeline: the newest TIMELINE_SLOTS kept lines, line `seq` at `seq % TIMELINE_SLOTS`. */
  readonly timeline: (TimelineLine | undefined)[];
  /** Lines kept so far: the seq of the next one. Never reset while perf runs. */
  timelineSeq: number;
  /** The display rate of the last kept `display` line (or the header's): a line with the same is not kept. */
  timelineHz: number | null;
  /** A `shader` line arrived: an old engine's `compile` lines are no longer kept. */
  shaderSeen: boolean;
  /** The newest two `passes` summary lines of the engine (next change), by reference. */
  readonly passesLines: (PerfPassesLine | undefined)[];
  /** `passes` lines received; the next slot is `passesLineNext % 2`. */
  passesLineNext: number;
  /** The newest sample's heap, for the frozen-counter test. */
  heapLast: number | null;
  /** Consecutive samples with `heapLast` while the window had awake frames, the newest included. */
  heapSame: number;
  /** perf's own read time per second, ms, an EMA; NaN before the first read. */
  editorMs: number;
  /** The system names the frames feed sends: a copy of `ring.systemNames`, renewed when it grows. */
  systemNames: readonly string[];
  /** The `ring.systemNames` array the copy was made of. */
  namesRef: readonly string[] | undefined;
  /** Its length then (an engine before the patch grows the same array). */
  namesLength: number;
};

/**
 * The context the perf domain files take: own config and state, the log and `require`.
 */
export type PerfCtx = {
  readonly config: Readonly<PerfConfig>;
  state: PerfState;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * The teardown context of perf's onStop: own config and state.
 */
export type PerfStopCtx = {
  readonly config: Readonly<PerfConfig>;
  state: PerfState;
};

/**
 * The perf API (`app.perf`, `ctx.require(perfPlugin)`): the performance model of the page for the
 * overlay and the recorder. The tools page and MCP read the same through the `editor.perf.*` sources.
 */
export type PerfApi = {
  /**
   * What perf can measure now: on (with frames lost since start and whether the page has a GPU
   * timer), waiting (a monitor without frames yet), or off (no renderer, or an engine without a
   * monitor).
   *
   * @returns The status; a fresh object.
   * @example
   * ```ts
   * // The overlay's Frames tab on a headless test game.
   * app.perf.status(); // { state: "off", reason: "no-renderer" }
   * ```
   */
  status(): PerfStatus;
  /**
   * Hands the last `windowMs` of frames to `visit`, synchronously, once. The window is perf's own
   * state, rewritten by every read (4 Hz): it is valid only inside `visit` — read it there, never
   * write it, never keep the reference (copy the numbers you keep); `version` tells whether it
   * changed since the last paint. Off or waiting: `visit` gets a window with `count` 0.
   * Allocation-free: the caller makes its visitor once (per mount). A throw of `visit` reaches the
   * caller and leaves the window unchanged.
   *
   * @param visit - Called with the live window as a read-only `PerfWindowView`.
   * @example
   * ```ts
   * // The overlay paints its graph on its own timer; the visitor was made once at mount.
   * const paintVisitor = (window: PerfWindowView): void => {
   *   if (window.version !== painted) paintGraph(g, window, view, graphState); // 358 rows at 60 fps
   * };
   * app.perf.readWindow(paintVisitor);
   * ```
   */
  readWindow(visit: (window: PerfWindowView) => void): void;
  /**
   * This second: fps of the window's last second, spikes in the window, the newest frame's budget
   * and the loop's rate, `renderer.stats()`, and the newest sample and screen facts from the
   * engine. Built when asked, cached until the next read, and frozen with its `fps`, `rate`,
   * `render` (and `render.kept`): a write fails and the next `second()` is unchanged.
   *
   * @returns The frozen PerfSecond (the same object until the next read).
   * @example
   * ```ts
   * // The pill: fps now and spikes in the last 6 s.
   * app.perf.second().fps; // { loop: 60, drawn: 54 }
   * app.perf.second().rate; // { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 }
   * ```
   */
  second(): PerfSecond;
  /**
   * The spikes of the window, oldest first, each with its primary cause and the one-line why.
   * Copies.
   *
   * @param query - Which spikes: all of the window by default.
   * @param query.lastMs - Only spikes that started that many ms before the newest frame; default and
   *   maximum `windowMs`, a value that is not a finite number counts as `windowMs`.
   * @returns The spike summaries; [] while off.
   * @example
   * ```ts
   * // MCP: "what stuttered in the last five seconds?"
   * app.perf.spikes({ lastMs: 5000 }); // [{ frame: 4812, ms: 41.3, cause: "upload", path: "garden/boss", … }]
   * ```
   */
  spikes(query?: { readonly lastMs?: number }): readonly PerfSpikeSummary[];
  /**
   * The record of one spike of the window: its numbers from the ring (or, once the slot was
   * overwritten, from the engine's spike line) and, once the spike line arrived, its full detail.
   * Copies.
   *
   * @param frame - The frame number.
   * @returns The record; undefined when the frame is not a spike of the window.
   * @example
   * ```ts
   * // The overlay opens the record of the tapped flag.
   * app.perf.spike(4812)?.why; // "41.0 MB of textures uploaded this frame (bundle garden-boss)"
   * ```
   */
  spike(frame: number): PerfSpikeRecord | undefined;
  /**
   * The engine monitor perf found, for the plugin that logs through it (the recorder).
   *
   * @returns The monitor; undefined when perf is off.
   * @example
   * ```ts
   * // recorder, at start: subscribe to the log of the page.
   * const off = ctx.require(perfPlugin).monitor()?.stream(line => queue.push(line));
   * ```
   */
  monitor(): MonitorLike | undefined;
};
