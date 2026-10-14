/* eslint-disable sonarjs/todo-tag -- each structural engine copy keeps its TODO(engine) swap marker until 11-monitor ships */
/**
 * @file perf/protocol — the editor's view of the engine's performance monitor (engine spec
 * 11-monitor, "11:<line>" below; frame-rate types from spec 21): the frame ring, the log lines,
 * their event details and the monitor itself. Runtime-free: its only import is the protocol `Json`
 * type. The installed engine (0.14.12) exports none of these yet, so every type is a structural
 * copy, field for field; each is swapped for `export type … from "@moku-labs/game"` when the engine
 * ships 11-monitor, and engine-contract.test.ts (unit 03) compares every copy that stays.
 */
import type { Json } from "../../registry/protocol";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The version every log line carries as `v` (11:930, 11:1135). The editor keeps its own constant: a
 * value import from the engine root would pull the engine into the tools bundle.
 */
export const PERF_LOG_VERSION = 1;

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Buckets of a sample's `frameHist` (11:1006-1007): [0,1) … [49,50) ms, then [50,55) … [195,200) ms,
 * then 200 ms and over.
 */
export const PERF_GAP_BUCKETS = 81;

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The frame phases in the engine's order (11:731, 11:1016): `phaseMs` holds 6 values a frame, at
 * `slot * 6 + phase index`.
 */
export const PHASES = ["input", "animate", "layout", "sync", "signals", "render"] as const;

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The frame ring's live columns (11:729-744, addendum 11:1786-1791, addendum 3B/4 item 4): one typed
 * array per measure, indexed by slot. `NaN` in a Float32Array column means "not measured".
 *
 * @example
 * ```ts
 * const ring = app.renderer.monitor.frames();
 * ring.columns.workMs[ring.newest]; // 3.4
 * ```
 */
export type FrameColumns = {
  frame: Uint32Array;
  t: Float64Array;
  gapMs: Float32Array;
  capMs: Float32Array;
  skipped: Uint8Array;
  startMs: Float32Array;
  /** One frame of the loop's rate, ms (R8.5). */
  rateMs: Float32Array;
  /** The budget the spike rules used for the frame: `1000 / rate` under "rate", the fixed number otherwise. */
  budgetMs: Float32Array;
  /** capacity * 6: slot * 6 + phase index (PHASES order). */
  phaseMs: Float32Array;
  /** The agent phase (R8.9). */
  agentMs: Float32Array;
  workMs: Float32Array;
  drawn: Uint8Array;
  idle: Uint8Array;
  stepped: Uint8Array;
  passes: Float32Array;
  stencilPasses: Float32Array;
  draws: Float32Array;
  filterApplies: Float32Array;
  filterMpx: Float32Array;
  uploads: Float32Array;
  uploadMb: Float32Array;
  compiles: Float32Array;
  marks: Float32Array;
  rebuilds: Float32Array;
  gpuMs: Float32Array;
  gpuPartial: Uint8Array;
  path: Uint16Array;
  changed: Uint8Array;
  causes: Uint8Array;
  /** Reserved: the draw reason of spec 14; 255 = not measured. */
  reason: Uint8Array;
  /** capacity * 5: the five slowest world systems of the frame (H2b); 0xffff = empty. */
  sysIdx: Uint16Array;
  sysMs: Float32Array;
  /** capacity * 4: the four filter kinds with the most pixels (R4.3). */
  fltKind: Uint8Array;
  fltApplies: Uint16Array;
  fltMpx: Float32Array;
  /** Pictures drawn as one texture in the frame (spec 23 P12.2); NaN before attach. */
  kept: Float32Array;
  /** Takes of kept pictures in the frame (spec 23 P12.2); NaN before attach. */
  retakes: Float32Array;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * What `read` did (11:747-753): one object owned by the ring, rewritten by every call.
 * `copied + lost = written − since`.
 *
 * @example
 * ```ts
 * const result: FrameReadResult = { copied: 1, lost: 0 }; // a steady 120 fps read
 * ```
 */
export type FrameReadResult = {
  /** Frames copied into `into`, oldest first. */
  copied: number;
  /** Frames committed after the cursor that this read did not copy. */
  lost: number;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Caller-owned arrays `read` fills (11:755): any subset of the columns, each at least `length` long.
 *
 * @example
 * ```ts
 * const into: FrameReadout = { length: 720, workMs: new Float32Array(720), drawn: new Uint8Array(720) };
 * ```
 */
export type FrameReadout = Partial<FrameColumns> & { length: number };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The render-pass ring of `FrameRing.passes` (11:762-767, inlined by the engine): capacity * 4
 * passes; `label` holds references, never copies.
 */
export type PassColumns = {
  readonly capacity: number;
  readonly size: number;
  readonly newest: number;
  readonly written: number;
  frame: Uint32Array;
  index: Uint8Array;
  kind: Uint8Array;
  stencil: Uint8Array;
  width: Uint16Array;
  height: Uint16Array;
  gpuMs: Float32Array;
  label: (string | null)[];
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The frame ring of the monitor (11:757-777): a structure of arrays, the same object on every
 * `frames()` call. The k-th committed frame lives in slot `k % capacity` until it is overwritten.
 *
 * @example
 * ```ts
 * const ring: FrameRing = app.renderer.monitor.frames();
 * const result = ring.read(into, cursor); // { copied: 1, lost: 0 }
 * cursor = ring.written;
 * ```
 */
export type FrameRing = {
  /** `config.monitor.frames` in an agent build; 0 otherwise. */
  readonly capacity: number;
  /** Records held, at most capacity. */
  readonly size: number;
  /** Slot of the newest record; -1 while empty. */
  readonly newest: number;
  /** Frames ever committed; a reader keeps it as its cursor. */
  readonly written: number;
  /** The live columns, written in place: read, never write. */
  readonly columns: FrameColumns;
  readonly passes: PassColumns;
  /** Path id → flow path. */
  readonly paths: readonly string[];
  /**
   * Copies the frames committed after the cursor `since`, oldest first, into the columns `into`
   * provides, at most `into.length` of the newest. Allocates nothing.
   *
   * @param into - The caller's arrays.
   * @param since - A `written` value read earlier.
   * @returns How many frames it copied and how many it lost.
   */
  read(into: FrameReadout, since: number): Readonly<FrameReadResult>;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Why a frame is a spike, and its annotations (11:1009): bits of the `causes` column in this order.
 *
 * @example
 * ```ts
 * const cause: PerfCause = "gc?"; // a hint, never a certainty
 * ```
 */
export type PerfCause = "gap" | "js" | "gpu" | "compile" | "upload" | "longFrame" | "gc?";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * What changed in a frame (11:1010): bits of the `changed` column in this order.
 */
export type PerfChange = "resize" | "resolution" | "scene" | "bundle" | "restore";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A change of a frame and, where an event named it, its subject (11:1011-1012).
 *
 * @example
 * ```ts
 * const change: PerfChangeEntry = { kind: "scene", what: "board" };
 * ```
 */
export type PerfChangeEntry = { kind: PerfChange; what: string | null };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * What a build and backend measure, listed in the header (11:938-940, addendum 3B/4 item 4).
 */
export type PerfMeasured =
  | "gpu"
  | "passes"
  | "stencilPasses"
  | "draws"
  | "filters"
  | "uploads"
  | "compiles"
  | "marks"
  | "rebuilds"
  | "longFrames"
  | "heap"
  | "systems"
  | "kept";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The native shell's thermal reading (`Time.ThermalReading`, 11:271-293): a field the shell left out
 * is `null`.
 *
 * @example
 * ```ts
 * const reading: ThermalReading = { status: 2, headroom: 0.71, at: 1791986090000, android: null };
 * ```
 */
export type ThermalReading = {
  status: number | string | null;
  headroom: number | null;
  at: number | null;
  android: {
    status: number | string | null;
    headroom: number | null;
    forecastSeconds: number | null;
  } | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * What the screen is (11:960-964): in the header and in every `display` event.
 */
export type PerfDisplay = {
  dpr: number;
  resolution: number;
  maxResolution: number;
  canvas: { w: number; h: number };
  css: { w: number; h: number };
  safeArea: { t: number; r: number; b: number; l: number };
  backend: "webgpu" | "webgl" | "none";
  orientation: "portrait" | "landscape";
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * One frame with everything known about it (11:1014-1027, addendum 11:1786-1789, addendum 3B/4
 * item 4): the frame record of a spike line.
 */
export type FrameRecord = {
  frame: number;
  t: number;
  gapMs: number | null;
  capMs: number;
  rateMs: number;
  /** The budget the spike rules used for this frame. */
  budgetMs: number;
  skipped: number;
  startMs: number;
  phases: {
    input: number;
    animate: number;
    layout: number;
    sync: number;
    signals: number;
    render: number;
    agent: number;
  };
  /** Includes `phases.agent` when the agent worked inside the frame's callbacks. */
  workMs: number;
  drawn: boolean;
  idle: boolean;
  stepped: boolean;
  /** Spec 14's draw reason; null before block 3A. */
  reason: string | null;
  passes: number | null;
  stencilPasses: number | null;
  draws: number | null;
  filters: {
    applies: number;
    mpx: number;
    kinds: readonly { kind: string; applies: number; mpx: number }[];
  } | null;
  uploads: { count: number; mb: number } | null;
  compiles: number | null;
  marks: number | null;
  rebuilds: number | null;
  systems: readonly { name: string; ms: number }[] | null;
  gpuMs: number | null;
  gpuPartial: boolean;
  path: string;
  changed: readonly PerfChangeEntry[];
  causes: readonly PerfCause[];
  /** Kept pictures drawn and their takes in the frame (spec 23 P12.2). */
  kept: { pictures: number; retakes: number } | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The kind of a render pass (11:1029).
 */
export type PassKind = "canvas" | "texture" | "filter";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * One render pass of a spike (11:1030-1032).
 */
export type PassRecord = {
  index: number;
  kind: PassKind;
  label: string | null;
  stencil: boolean | null;
  w: number;
  h: number;
  gpuMs: number | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A Long Animation Frame with its script attribution (11:1046-1049).
 */
export type LongFrameEntry = {
  startMs: number;
  durationMs: number;
  blockingMs: number | null;
  renderStartMs: number | null;
  styleLayoutMs: number | null;
  scripts: readonly {
    invoker: string;
    type: string;
    source: string;
    fn: string;
    ms: number;
    forcedLayoutMs: number;
  }[];
};

/**
 * The fields every log line has (11:936): the version, the kind, the page epoch ms and spec 10's
 * build id (`null` without one).
 */
type PerfLine<Kind extends string> = {
  v: typeof PERF_LOG_VERSION;
  kind: Kind;
  t: number;
  build: string | null;
};

/**
 * p50, p90 and max of a second (11:974).
 */
type Spread = { p50: number; p90: number; max: number };

/**
 * Mean and max of a second (11:975).
 */
type MeanMax = { mean: number; max: number };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The engine's frame-rate mode (spec 21 G1.3): `"fixed"` (`maxFps`), `"auto"` (the adaptive rule),
 * `"forced"` (`setRate` with a number).
 */
export type RateMode = "fixed" | "auto" | "forced";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Why the rate is what it is: the reason of the last change (spec 21 G1.3).
 */
export type RateReason =
  | "start"
  | "display"
  | "missed"
  | "headroom"
  | "thermal"
  | "forced"
  | "auto";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The native shell's thermal status, normalized (spec 21 G1.3).
 */
export type ThermalStatus =
  | "none"
  | "light"
  | "moderate"
  | "severe"
  | "critical"
  | "emergency"
  | "shutdown";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The loop's frame rate as `app.time.rate()` answers it (spec 21 G1.3).
 *
 * @example
 * ```ts
 * const rate: FrameRate = { fps: 60, mode: "auto", reason: "missed", displayHz: 120, ladder: [120, 60], thermal: "none" };
 * ```
 */
export type FrameRate = {
  /** Frames per second the loop runs at, the idle cap left out. */
  fps: number;
  mode: RateMode;
  reason: RateReason;
  /** Refresh rate of the display in Hz; `null` until known, and always without `adaptive`. */
  displayHz: number | null;
  /** The rates the adaptive rule chooses from, highest first. */
  ladder: readonly number[];
  /** The native shell's last thermal status; `null` without a shell. */
  thermal: ThermalStatus | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A change of the loop's rate or of its mode (spec 21 G1.3): the payload of `time:rate` and the
 * `detail` of a `rate` event line.
 *
 * @example
 * ```ts
 * const change: RateChange = { from: 120, to: 60, reason: "missed", mode: "auto", displayHz: 120, thermal: "none", window: { drawn: 41, missed: 9, heavy: 0 }, dwellMs: 5000 };
 * ```
 */
export type RateChange = {
  from: number;
  to: number;
  reason: RateReason;
  mode: RateMode;
  displayHz: number | null;
  thermal: ThermalStatus | null;
  /** Drawn intervals, the late ones and the heavy ones of the window the rule read. */
  window: { drawn: number; missed: number; heavy: number };
  /** How long a return must now wait at the lower rate, ms. */
  dwellMs: number;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The first line a subscriber gets (11:944-958, addendum 11:1790-1791): device, GPU, display,
 * thermal, rate and config at subscribe time. `rate` is optional: a block-2b header has no key.
 */
export type PerfHeaderLine = PerfLine<"header"> & {
  /** `performance.timeOrigin`: epoch ms of page-clock 0. */
  timeOrigin: number;
  /** Spec 10's engine fingerprint, `__MOKU_GAME_ENGINE__`. */
  engine: string | null;
  device: {
    userAgent: string;
    model: string | null;
    modelFrom: "shell" | "ua" | null;
    webview: string | null;
    cores: number | null;
    memoryGb: number | null;
  };
  gpu: {
    backend: "webgpu" | "webgl" | "none";
    vendor: string | null;
    architecture: string | null;
    renderer: string | null;
    timer: "timestamp-query" | "disjoint-timer" | null;
  };
  display: PerfDisplay;
  thermal: ThermalReading | null;
  rate?: Readonly<FrameRate>;
  /** `budget` is the configured value; `budgetMs` the resolved budget at subscribe time. */
  config: {
    maxFps: number;
    idleFps: number;
    budgetMs: number;
    budget: number | "rate";
    frames: number;
  };
  measured: readonly PerfMeasured[];
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The page's startup, once measured (11:966-975).
 */
export type PerfStartupLine = PerfLine<"startup"> & {
  htmlMs: number | null;
  script: { url: string; fetchEndMs: number; transferKb: number; decodedKb: number } | null;
  parseMs: number | null;
  evaluateMs: number | null;
  pixiMs: number | null;
  initMs: number | null;
  firstFrameMs: number;
  longFrames: {
    count: number;
    totalMs: number;
    maxMs: number;
    blockingMs: number | null;
    top: readonly LongFrameEntry[];
  } | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * One second of the loop (11:977-1004, addendum 3B/4 item 4): frames, gaps, work, phases, systems,
 * GPU, passes, draws, filters, uploads, textures and kept pictures.
 */
export type PerfSampleLine = PerfLine<"sample"> & {
  /** Newest frame of the second. */
  frame: number;
  /** Page-clock length of the window, about 1000. */
  windowMs: number;
  /** Flow path at the flush. */
  path: string;
  /** rAF ticks: frames + skipped. */
  ticks: number;
  frames: number;
  drawn: number;
  idle: number;
  gaps: { missed: number; drawn: number; idle: number };
  gapMs: { p50: number; p90: number; p99: number } | null;
  /** PERF_GAP_BUCKETS counts of gapMs. */
  frameHist: readonly number[];
  workMs: Spread;
  overBudget: number;
  phasesMs: {
    start: MeanMax;
    input: MeanMax;
    animate: MeanMax;
    layout: MeanMax;
    sync: MeanMax;
    signals: MeanMax;
    render: MeanMax;
    agent: MeanMax;
  };
  systems: readonly { name: string; mean: number; max: number }[] | null;
  gpuMs: (Spread & { frames: number }) | null;
  passes: { mean: number; max: number; stencil: number | null } | null;
  draws: MeanMax | null;
  filters: { applies: MeanMax; mpx: number } | null;
  uploads: { count: number; mb: number } | null;
  compiles: number | null;
  marks: MeanMax | null;
  rebuilds: number | null;
  longFrames: { count: number; maxMs: number; blockingMs: number | null } | null;
  heapMb: number | null;
  textures: { count: number; mb: number; art: number; targets: number; kept: number };
  views: number;
  pooled: number;
  resolution: number;
  /** Mean listenersMs: what measuring cost per frame. */
  monitorMs: number;
  spikes: number;
  /** Kept pictures of the second (spec 23 P12.2). */
  kept: { pictures: number; mb: number; retakes: number; refreshes: number } | null;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A frame over the budget, with everything known about it (11:1034-1044).
 */
export type PerfSpikeLine = PerfLine<"spike"> & {
  frame: FrameRecord;
  systems: readonly { name: string; ms: number }[] | null;
  compiles: readonly { label: string | null; ms: number }[];
  filters: readonly { kind: string; applies: number; mpx: number }[];
  passes: readonly PassRecord[];
  longFrames: readonly LongFrameEntry[];
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A Long Animation Frame as the observer delivered it (11:1050).
 */
export type PerfLongFrameLine = PerfLine<"longFrame"> &
  LongFrameEntry & { frames: readonly [number, number] | null };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The names of event lines after blocks 3B and 4 (11:1052-1055, addendum 3B/4 item 1). `overlay` is
 * the game's overlays only; the editor's own window is `devtools`.
 */
export type PerfEventName =
  | "scene"
  | "overlay"
  | "bundle"
  | "compile"
  | "upload"
  | "resolution"
  | "device-lost"
  | "device-restored"
  | "pause"
  | "resume"
  | "switch"
  | "display"
  | "command"
  | "recorder"
  | "devtools"
  | "rate"
  | "pool-trim"
  | "warm";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Something that happened, at the frame it happened in (11:1056); `frame` is null between frames.
 */
export type PerfEventLine = PerfLine<"event"> & {
  frame: number | null;
  name: PerfEventName;
  detail: Readonly<Record<string, Json>>;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A mark: `monitor.mark(label)` (`auto: false`), or a new flow rest path (`auto: true`) (11:1058).
 */
export type PerfMarkLine = PerfLine<"mark"> & { label: string; auto: boolean };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * A thermal reading, written by the engine from the shell or by a collector on the computer
 * (11:1060-1067).
 */
export type PerfThermalLine = PerfLine<"thermal"> &
  ThermalReading & {
    source: "shell" | "collector";
    device: string | null;
    batteryC: number | null;
    sensors: Readonly<Record<string, number>> | null;
  };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Lines a collector on the computer writes into the same file (11:1069-1072); the engine never
 * produces them.
 */
export type PerfCollectorLine = PerfLine<"gfx"> & {
  device: string;
  seconds: number;
  frames: number;
  janky: number;
  fps: number;
  p50: number;
  p90: number;
  p99: number;
  hist: Readonly<Record<string, number>>;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * One line of the performance log, v1 (11:932-934): one JSON object per line of a `.jsonl` file.
 *
 * @example
 * ```ts
 * const line: PerfLogLine = { v: 1, kind: "mark", t: 1760454000123.45, build: "debug-20261014T153012Z", label: "boss", auto: false };
 * ```
 */
export type PerfLogLine =
  | PerfHeaderLine
  | PerfStartupLine
  | PerfSampleLine
  | PerfSpikeLine
  | PerfLongFrameLine
  | PerfEventLine
  | PerfMarkLine
  | PerfThermalLine
  | PerfCollectorLine;

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * What a game overlay did (engine spec 22 O10.2): the `what` of an `overlay` event.
 */
export type OverlayWhat = "open" | "landed" | "leave" | "gone" | "live" | "kept";

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The detail of a game `overlay` event line (spec 22 O10.2). `mode` is the engine's `OverlayMode`,
 * read as a string so a new mode shows instead of failing the guard.
 *
 * @example
 * ```ts
 * const detail: OverlayEventDetail = { entity: 412, label: "pause menu", what: "open", mode: "modal" };
 * ```
 */
export type OverlayEventDetail = {
  entity: number;
  label: string;
  what: OverlayWhat;
  mode: string;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The detail of a `pool-trim` event line (spec 25 M1.8): why the filter texture pool was trimmed,
 * and the MB it freed.
 *
 * @example
 * ```ts
 * const trim: PoolTrimDetail = { reason: "rest", freedMb: 12.5 };
 * ```
 */
export type PoolTrimDetail = { reason: "rest" | "scene" | "pause"; freedMb: number };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The detail of a `warm` event line (spec 27 P2.3.8): the draws of a pipeline warm-up run.
 *
 * @example
 * ```ts
 * const warm: WarmDetail = { draws: 18 };
 * ```
 */
export type WarmDetail = { draws: number };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The detail of the editor's own `devtools` event line (addendum 3B/4 item 1): the overlay window's
 * mode and tab. The recorder writes it; perf ignores it.
 *
 * @example
 * ```ts
 * const devtools: DevtoolsDetail = { mode: "card", tab: "frames" };
 * ```
 */
export type DevtoolsDetail = { mode: "hidden" | "pill" | "card"; tab: string };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * Kept pictures of the last drawn frame (spec 23 P12.1): pictures drawn as one texture, the MB their
 * textures hold, and retakes in the last full second.
 *
 * @example
 * ```ts
 * const kept: KeptStats = { pictures: 1, mb: 1.4, retakes: 0 };
 * ```
 */
export type KeptStats = { pictures: number; mb: number; retakes: number };

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The members of the engine's `RenderStats` perf reads (11 R12.2, addendum 3B/4 item 3):
 * `renderPassesMax` and `kept` in every build, `redraws` / `rebuilds` in dev or agent builds only.
 *
 * @example
 * ```ts
 * const stats: RenderStatsLike = { renderPasses: 3, renderPassesMax: 3, kept: { pictures: 1, mb: 1.4, retakes: 0 }, redraws: 0, rebuilds: 0 };
 * ```
 */
export type RenderStatsLike = {
  renderPasses: number;
  renderPassesMax: number;
  kept: KeptStats;
  redraws?: number;
  rebuilds?: number;
};

// TODO(engine): replace with export type from @moku-labs/game once 11-monitor ships
/**
 * The engine's performance monitor as the editor uses it: `app.renderer.monitor` of an agent build
 * (11-monitor R13.1, 11:1153-1158). In a build without the agent flag every member exists and does
 * nothing: `frames()` answers a ring of capacity 0, `stream` never calls.
 *
 * @example
 * ```ts
 * // perf finds it on the game it wraps.
 * const monitor: MonitorLike | undefined = monitorOf(registry.game());
 * monitor?.frames().capacity; // 1024 on a debug build of the phone
 * ```
 */
export type MonitorLike = {
  /**
   * 11:1291-1314. The header (and startup) at once, then samples, spikes, long frames, events,
   * marks, thermal; each line fresh and deeply frozen.
   *
   * @param listener - Called with each line.
   * @returns The unsubscribe.
   */
  stream(listener: (line: PerfLogLine) => void): () => void;
  /**
   * 11:1317-1334. The same ring object on every call.
   *
   * @returns The frame ring.
   */
  frames(): FrameRing;
  /**
   * 11:1337-1349. A mark line, `auto: false`.
   *
   * @param label - The mark's label.
   */
  mark(label: string): void;
  /**
   * 11:1352-1369. An event line at the frame it happens in.
   *
   * @param name - The event name.
   * @param detail - The event detail.
   */
  event(name: PerfEventName, detail?: Readonly<Record<string, Json>>): void;
  /**
   * 11:1372-1394. Opens a span of agent work (a nested begin is ignored).
   */
  beginAgent(): void;
  /**
   * 11:1372-1394. Closes the span (an end without a begin is ignored).
   */
  endAgent(): void;
  /**
   * 11:1399-1418. The A/B resolution switch; the editor does not call it.
   *
   * @param resolution - The resolution, or undefined for the default.
   * @returns The resolution now.
   */
  setResolution(resolution: number | undefined): number;
};
