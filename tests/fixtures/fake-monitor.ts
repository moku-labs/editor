/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's log lines (11-monitor) */
/**
 * @file The fake performance monitor of engine spec 11-monitor, for the unit tests of perf,
 * recorder, bridge and overlay (spec 03 revision 6: a root fixture next to moku-game.ts). A ring of
 * configurable capacity with `commit(frame)` and `read(into, since)` by engine facts 1–5, `stream`
 * delivering a frozen header at subscribe, `emit(line)` for frozen lines, `beginAgent` / `endAgent`
 * counters, and `mark` / `event` recorded AND delivered to the listeners as frozen `mark` / `event`
 * lines (the engine's writeMark / writeEvent: between frames, `frame` null); plus builders of valid
 * log lines. Its shape is checked
 * against the real engine by perf's `engine-contract.test.ts` (the engine's own `frameAt` reads its
 * ring).
 *
 * Mission control (spec 03 Delta 2026-10-16 D1, D14; engine reconciliation 2026-10-16): the pass
 * ring is written with `commitPass` (slot `written % capacity`, the engine's `writePass`) and
 * carries the 0.15.x columns `owner`, `kind2` (1-based: 0 none, else `ring.kindNames[kind2 - 1]`,
 * the names on the frame ring as in the engine), `drawsAt`, `format` and `resolution` unless
 * `passColumns: false` models an older engine; the frame columns include the 0.15.1 render-target
 * counts (NaN: not counted); `ring.systemNames` grows by `addSystem` with a new array (the patch) or
 * in place (0.15.0);
 * `monitor.sections(next?)` and `monitor.detail({ from, to })` of the next change exist unless
 * switched `"absent"`, and refuse with an error tagged `reason: "read-only"` / `"dev-only"` when
 * switched so; `emit` also delivers the lines of a newer engine (`passes`, and the event names
 * `shader`, `problem`, `gc`, `sections`, `debug`), and the builders write them, the patch's header
 * (`app.id` with the `.debug` suffix, `debug.overdraw`) and its sample (`targets`, `counts`).
 * `ENGINE_0_15_0` is the options of the peer floor's engine (the dev engine is 0.15.1, the patch).
 */
import { frameAt } from "@moku-labs/game";
import type {
  DebugEventDetail,
  FrameColumns,
  FrameRecord,
  FrameRing,
  GcEventDetail,
  MonitorLike,
  MonitorSectionName,
  MonitorSections,
  PassColumnsNext,
  PassKind,
  PassRecord,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfEventNameNext,
  PerfHeaderLine,
  PerfHeaderNext,
  PerfLogLine,
  PerfMarkLine,
  PerfPassesLine,
  PerfSampleLine,
  PerfSampleNext,
  PerfSpikeLine,
  ProblemEventDetail,
  RateChange,
  SectionsEventDetail,
  ShaderEventDetail,
  TimelineEventLine
} from "../../src/plugins/perf/protocol";
import { MONITOR_SECTIONS, SECTION_DEFAULTS } from "../../src/plugins/perf/protocol/sections";
import type { Json } from "../../src/plugins/registry/protocol";

/** One of the five slowest systems of a frame: its registration index and its ms. */
export type FakeSystemTime = {
  /** The `sysIdx` value: an index into `ring.systemNames` (`addSystem` answers it). */
  readonly idx: number;
  readonly ms: number;
};

/** One frame to commit; every field but `t` has a default (a plain 60 fps frame, drawn). */
export type FakeFrame = {
  /** The frame number; one more than the last committed frame by default. */
  readonly frame?: number;
  /** Page-clock ms of the frame's start. */
  readonly t: number;
  /** NaN by default (no gap measured). */
  readonly gapMs?: number;
  readonly capMs?: number;
  readonly rateMs?: number;
  /** The rate's frame by default. */
  readonly budgetMs?: number;
  /** Six values in PHASES order; zeros by default. */
  readonly phaseMs?: readonly number[];
  readonly agentMs?: number;
  readonly workMs?: number;
  readonly drawn?: boolean;
  /** NaN by default (not measured). */
  readonly gpuMs?: number;
  readonly gpuPartial?: boolean;
  /** Cause bits in PerfCause order. */
  readonly causes?: number;
  /** Change bits in PerfChange order. */
  readonly changed?: number;
  readonly path?: string;
  readonly passes?: number;
  readonly draws?: number;
  readonly filterApplies?: number;
  readonly filterMpx?: number;
  readonly uploads?: number;
  readonly uploadMb?: number;
  readonly compiles?: number;
  /** Kept pictures drawn in the frame (spec 23); NaN (not measured) by default. */
  readonly kept?: number;
  /** Kept and range pictures taken in the frame (spec 23); NaN by default. */
  readonly retakes?: number;
  /** The draw reason of spec 14 (a `DEMAND_REASONS` index); 255 (not measured) by default; "none" is on demand, nothing drawn. */
  readonly reason?: number;
  /** The frame ran under the idle cap (time's `idle`). */
  readonly idle?: boolean;
  /** Demand marks of the frame (nodes updated); NaN (not measured) by default. */
  readonly marks?: number;
  /**
   * The slowest systems of the frame, slowest first, at most five. Absent: the frame had no
   * timing table (the first `sysMs` slot NaN, the record's `systems` null); `[]`: a table with
   * every system at 0 ms.
   */
  readonly systems?: readonly FakeSystemTime[];
};

/** One render pass to write into the pass ring; every field has a default (a canvas pass). */
export type FakePass = {
  /** The frame it belongs to; the last committed frame by default. */
  readonly frame?: number;
  /** Its index in the frame; 0 for a frame's first pass, one more than the previous by default. */
  readonly index?: number;
  /** "canvas" by default. */
  readonly kind?: PassKind;
  readonly label?: string | null;
  /** With a depth-stencil attachment; not measured (the engine's 255) by default. */
  readonly stencil?: boolean;
  /** Target width in pixels: 1080 by default. */
  readonly w?: number;
  /** Target height in pixels: 2340 by default. */
  readonly h?: number;
  /** NaN by default: the GPU time lands later (`landPassGpu`), as the engine's timer does. */
  readonly gpuMs?: number;
  /** The owner entity (0.15.x column `owner`); 0 (none) by default. */
  readonly owner?: number;
  /** The filter kind's name (0.15.x `kind2`, interned into `ring.kindNames`); null (none) by default. */
  readonly filter?: string | null;
  /** The draw-call counter at the pass's start (0.15.x `drawsAt`); 0 by default. */
  readonly drawsAt?: number;
  /** The target's format (0.15.x `format`); null by default. */
  readonly format?: string | null;
  /** The target's resolution (0.15.x `resolution`); NaN (not measured) by default. */
  readonly resolution?: number;
};

/**
 * How a member of the next engine change (`monitor.sections`, `monitor.detail`) behaves: present
 * on a build with control, refusing with an error tagged by the reason, or not there at all.
 */
export type FakeControl = "control" | "read-only" | "dev-only" | "absent";

/** How to build a fake monitor. */
export type FakeMonitorOptions = {
  /** Ring capacity; 0 = a build without the agent flag (or a renderer not attached yet). 64 by default. */
  readonly capacity?: number;
  /** The header delivered at subscribe; `null` for none. A default header by default. */
  readonly header?: FakeHeaderLine | null;
  /** False: the ring has no `budgetMs` column (an engine before the 11-monitor addendum). */
  readonly budgetColumn?: boolean;
  /**
   * True: the ring of an engine before fix A: after `restart()` the next frame goes to slot 0
   * (`(newest + 1) % capacity`), not to `written % capacity`.
   */
  readonly legacyReset?: boolean;
  /**
   * False: the pass ring has none of the 0.15.x columns (`owner`, `kind2`, `drawsAt`,
   * `format`, `resolution`), an engine before the patch. True by default.
   */
  readonly passColumns?: boolean;
  /**
   * How `ring.systemNames` grows at `addSystem`: "copy" (the 0.15.x patch, E8: a new array on
   * growth, the same reference across frames) by default; "in-place" (0.15.0: the same array
   * grows); "none" (the ring has no `systemNames`).
   */
  readonly systemNames?: "copy" | "in-place" | "none";
  /**
   * `monitor.sections(next?)` (next change, N1): "control" by default (reads and writes); with
   * "read-only" or "dev-only" a read answers and a write throws the tagged refusal; "absent" leaves
   * the member out.
   */
  readonly sections?: FakeControl;
  /**
   * `monitor.detail({ from, to })` (next change, N5): "control" by default; "read-only" or
   * "dev-only" refuse every call with the tagged error; "absent" leaves the member out.
   */
  readonly detail?: FakeControl;
};

/**
 * The options of the peer floor's engine (0.15.0): no 0.15.x pass columns, `systemNames` grown in
 * place, no `monitor.sections`, no `monitor.detail`.
 */
export const ENGINE_0_15_0: FakeMonitorOptions = {
  passColumns: false,
  systemNames: "in-place",
  sections: "absent",
  detail: "absent"
};

/** A monitor event the fake recorded. */
export type FakeEvent = {
  readonly name: PerfEventName;
  readonly detail: Readonly<Record<string, Json>>;
};

/** A call of `sections` or `detail`, with whether an agent span (`beginAgent`) was open. */
export type FakeControlCall = {
  readonly method: "sections" | "detail";
  /** The argument: the sections to write (undefined for a read), or the range. */
  readonly input:
    | Partial<MonitorSections>
    | { readonly from: number; readonly to: number }
    | undefined;
  readonly inAgent: boolean;
};

/** A pass of a `detail` answer: the engine's record, its frame and the 0.15.x fields. */
export type FakeDetailPass = PassRecord & {
  readonly frame: number;
  readonly owner: number | null;
  readonly filter: string | null;
  readonly drawsAt: number | null;
  readonly format: string | null;
  readonly resolution: number | null;
};

/**
 * The answer of `monitor.detail({ from, to })` (N5, the editor's proposal): the frames of the range
 * still held, their passes, their five slowest systems (rows × 5, `idx` −1 = none) and the demand
 * marks (null: the mark ring is a later change).
 */
export type FakeDetail = {
  readonly from: number;
  readonly to: number;
  readonly held: { readonly from: number; readonly to: number } | null;
  readonly frames: readonly FrameRecord[];
  readonly passes: readonly FakeDetailPass[];
  readonly systems: {
    readonly names: readonly string[];
    readonly idx: readonly number[];
    readonly ms: readonly number[];
  } | null;
  readonly marks: null;
};

/** The pass ring as the fake writes it: the engine's columns, the 0.15.x ones only when present. */
export type FakePassColumns = Omit<FrameRing["passes"], keyof PassColumnsNext> & PassColumnsNext;

/**
 * The ring of the fake: the engine's `FrameRing`, its pass ring with the 0.15.x columns when
 * present, the filter kind names `kind2` indexes, and the system names.
 */
export type FakeRing = Omit<FrameRing, "passes" | "kindNames" | "systemNames"> & {
  readonly passes: FakePassColumns;
  readonly kindNames: readonly string[];
  /** Absent with `systemNames: "none"`. */
  readonly systemNames?: readonly string[];
};

/** A header of the 0.15.x patch or later: the engine's header plus `app`, `debug` and `sections`. */
export type FakeHeaderLine = PerfHeaderLine & PerfHeaderNext;

/** A sample of the 0.15.x patch or later: the engine's sample plus `targets`, `counts` and the next change's fields. */
export type FakeSampleLine = PerfSampleLine & PerfSampleNext;

/** A line a fake can deliver: the installed engine's, an event of a newer name, or a `passes` line. */
export type FakeLogLine = PerfLogLine | TimelineEventLine | PerfPassesLine;

/** The fake monitor: a `MonitorLike` plus the test's controls and records. */
export type FakeMonitor = MonitorLike & {
  /** The ring `frames()` answers (the same object every call). */
  readonly ring: FakeRing;
  /** `beginAgent` calls. */
  begins: number;
  /** `endAgent` calls. */
  ends: number;
  /** `read` calls. */
  reads: number;
  /** Labels passed to `mark`. */
  readonly marks: string[];
  /** Events passed to `event`. */
  readonly events: FakeEvent[];
  /** Calls of `sections` and `detail`, oldest first. */
  readonly controlCalls: FakeControlCall[];
  /** Listeners subscribed now. */
  readonly listeners: number;
  /** The next `read` throws this. */
  failRead: Error | undefined;
  /**
   * Commits one frame into the next slot (`slot = (newest + 1) % capacity`).
   *
   * @returns The frame number.
   */
  commit(frame: FakeFrame): number;
  /**
   * A late GPU time lands for `frame` in its slot: sets `gpuMs`, clears `gpuPartial`, adds cause
   * bits. False when the slot no longer holds the frame.
   */
  landGpu(frame: number, gpuMs: number, causes?: number): boolean;
  /**
   * Writes one render pass into the pass ring at slot `written % capacity` (the engine's
   * `writePass`), its `gpuMs` NaN unless given, the 0.15.x columns when the ring has them.
   *
   * @returns The pass's sequence number: the pass ring's `written` before it.
   */
  commitPass(pass?: FakePass): number;
  /**
   * A late GPU time lands for the pass of `sequence` while the ring still holds it
   * (`written − sequence ≤ capacity`). False when it was overwritten.
   */
  landPassGpu(sequence: number, gpuMs: number): boolean;
  /**
   * Registers a world system: its name at the next index of `ring.systemNames`, a new array
   * ("copy") or the same one grown ("in-place"). Throws on a ring without names.
   *
   * @returns Its index: the `sysIdx` value of its frames.
   */
  addSystem(name: string): number;
  /** Delivers a line to every listener, deeply frozen; a newer engine's line as it is. */
  emit(line: FakeLogLine): void;
  /**
   * Resets the ring the way the engine's stop does (`stopPerf`): `size` 0 and `newest` -1, `written`
   * kept. The next frame k goes to slot `k % capacity` (engine fix A), or to slot 0 with `legacyReset`.
   */
  restart(): void;
  /** `monitor.sections(next?)` of the next change; absent with `sections: "absent"`. */
  sections?: (next?: Partial<MonitorSections>) => MonitorSections;
  /** `monitor.detail({ from, to })` of the next change; absent with `detail: "absent"`. */
  detail?: (range: { readonly from: number; readonly to: number }) => FakeDetail;
};

/** The frame columns and their values per frame (stride). */
const STRIDES: Readonly<Record<keyof FrameColumns, number>> = {
  frame: 1,
  t: 1,
  gapMs: 1,
  capMs: 1,
  skipped: 1,
  startMs: 1,
  rateMs: 1,
  budgetMs: 1,
  phaseMs: 6,
  agentMs: 1,
  workMs: 1,
  drawn: 1,
  idle: 1,
  stepped: 1,
  passes: 1,
  stencilPasses: 1,
  draws: 1,
  filterApplies: 1,
  filterMpx: 1,
  uploads: 1,
  uploadMb: 1,
  compiles: 1,
  marks: 1,
  rebuilds: 1,
  gpuMs: 1,
  gpuPartial: 1,
  path: 1,
  changed: 1,
  causes: 1,
  reason: 1,
  sysIdx: 5,
  sysMs: 5,
  fltKind: 4,
  fltApplies: 4,
  fltMpx: 4,
  kept: 1,
  retakes: 1,
  targetsCreated: 1,
  targetsDestroyed: 1
};

/** The column names in a fixed order. */
const COLUMN_NAMES = Object.keys(STRIDES) as (keyof FrameColumns)[];

/** An empty `sysIdx` slot (the engine's `NO_SYSTEM`). */
const NO_SYSTEM = 0xff_ff;

/** The slowest systems a frame keeps (`sysIdx` / `sysMs` stride). */
const SYSTEMS_PER_FRAME = 5;

/** Pass ring slots per frame of capacity (the engine's `capacity * 4`). */
const PASSES_PER_FRAME = 4;

/** A stencil cell that was not measured (the engine's `NO_STENCIL`). */
const NO_STENCIL = 255;

/** The pass ring's `kind` byte of each pass kind (the engine's `writePass`: 0 canvas, 1 texture, 2 filter). */
const PASS_KIND_BYTE: Readonly<Record<PassKind, number>> = { canvas: 0, texture: 1, filter: 2 };

/** The pass kinds by their byte. */
const PASS_KIND_NAMES: readonly PassKind[] = ["canvas", "texture", "filter"];

/**
 * Allocates the 39 columns of a ring of `capacity` frames.
 *
 * @param capacity - Frames.
 * @returns The columns.
 */
function createColumns(capacity: number): FrameColumns {
  return {
    frame: new Uint32Array(capacity),
    t: new Float64Array(capacity),
    gapMs: new Float32Array(capacity),
    capMs: new Float32Array(capacity),
    skipped: new Uint8Array(capacity),
    startMs: new Float32Array(capacity),
    rateMs: new Float32Array(capacity),
    budgetMs: new Float32Array(capacity),
    phaseMs: new Float32Array(capacity * 6),
    agentMs: new Float32Array(capacity),
    workMs: new Float32Array(capacity),
    drawn: new Uint8Array(capacity),
    idle: new Uint8Array(capacity),
    stepped: new Uint8Array(capacity),
    passes: new Float32Array(capacity),
    stencilPasses: new Float32Array(capacity),
    draws: new Float32Array(capacity),
    filterApplies: new Float32Array(capacity),
    filterMpx: new Float32Array(capacity),
    uploads: new Float32Array(capacity),
    uploadMb: new Float32Array(capacity),
    compiles: new Float32Array(capacity),
    marks: new Float32Array(capacity),
    rebuilds: new Float32Array(capacity),
    gpuMs: new Float32Array(capacity),
    gpuPartial: new Uint8Array(capacity),
    path: new Uint16Array(capacity),
    changed: new Uint8Array(capacity),
    causes: new Uint8Array(capacity),
    reason: new Uint8Array(capacity),
    sysIdx: new Uint16Array(capacity * SYSTEMS_PER_FRAME),
    sysMs: new Float32Array(capacity * SYSTEMS_PER_FRAME),
    fltKind: new Uint8Array(capacity * 4),
    fltApplies: new Uint16Array(capacity * 4),
    fltMpx: new Float32Array(capacity * 4),
    kept: new Float32Array(capacity).fill(Number.NaN),
    retakes: new Float32Array(capacity).fill(Number.NaN),
    targetsCreated: new Float32Array(capacity).fill(Number.NaN),
    targetsDestroyed: new Float32Array(capacity).fill(Number.NaN)
  };
}

/** The pass ring the fake writes. */
type MutablePasses = {
  capacity: number;
  size: number;
  newest: number;
  written: number;
  frame: Uint32Array;
  index: Uint8Array;
  kind: Uint8Array;
  stencil: Uint8Array;
  width: Uint16Array;
  height: Uint16Array;
  gpuMs: Float32Array;
  label: (string | null)[];
  owner?: Uint32Array;
  kind2?: Uint8Array;
  drawsAt?: Uint16Array;
  format?: (string | null)[];
  resolution?: Float32Array;
};

/**
 * Allocates the pass ring: `slots` pre-sized cells per column (labels and formats `null`), the
 * 0.15.x columns only when the engine has them.
 *
 * @param slots - Passes the ring holds.
 * @param withColumns - The 0.15.x columns exist.
 * @returns The pass ring.
 */
function createPasses(slots: number, withColumns: boolean): MutablePasses {
  const passes: MutablePasses = {
    capacity: slots,
    size: 0,
    newest: -1,
    written: 0,
    frame: new Uint32Array(slots),
    index: new Uint8Array(slots),
    kind: new Uint8Array(slots),
    stencil: new Uint8Array(slots),
    width: new Uint16Array(slots),
    height: new Uint16Array(slots),
    gpuMs: new Float32Array(slots),
    label: Array.from<string | null>({ length: slots }).fill(null)
  };
  if (!withColumns) return passes;
  return {
    ...passes,
    owner: new Uint32Array(slots),
    kind2: new Uint8Array(slots),
    drawsAt: new Uint16Array(slots),
    format: Array.from<string | null>({ length: slots }).fill(null),
    resolution: new Float32Array(slots).fill(Number.NaN)
  };
}

/**
 * Freezes a value and everything it holds (engine fact 7: lines are deeply frozen).
 *
 * @param value - The value.
 * @returns The same value, frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
  return Object.freeze(value);
}

/**
 * The display of the default header: a Samsung A26 in portrait, its refresh rate not learned yet
 * (`hz` null: the engine writes it once time knows the panel, then sends a `display` event).
 */
export const DISPLAY: PerfDisplay = {
  hz: null,
  dpr: 2.81,
  resolution: 2,
  maxResolution: 2,
  canvas: { w: 1080, h: 2340 },
  css: { w: 540, h: 1170 },
  safeArea: { t: 32, r: 0, b: 24, l: 0 },
  backend: "webgpu",
  orientation: "portrait"
};

/** The app id of a native debug install (engine S-E3: the `.debug` suffix), in the patch's header. */
export const APP_ID = "com.moku.garden.debug";

/**
 * A valid header line (11:944-958): a debug build in an Android WebView at 120 fps, budget "rate",
 * with a GPU timer and no `rate` key (a block-2b engine); the display's Hz not learned yet. The
 * clock anchor is `timeOrigin` (`epochMs = timeOrigin + t` of the page clock).
 *
 * @param overrides - Fields to replace (or add: `app`, `debug`, `sections` of a newer engine).
 * @returns The header.
 */
export function headerLine(overrides: Partial<FakeHeaderLine> = {}): FakeHeaderLine {
  return {
    v: 1,
    kind: "header",
    t: 1_760_454_000_000,
    build: "debug-20261014T160000Z",
    timeOrigin: 1_760_453_960_000,
    engine: "0.14.12+9c41e0",
    device: {
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36",
      model: "SM-A266B",
      modelFrom: "ua",
      webview: "141",
      browser: "141",
      cores: 8,
      memoryGb: 6
    },
    gpu: {
      backend: "webgpu",
      vendor: "arm",
      architecture: "valhall",
      renderer: null,
      timer: "timestamp-query"
    },
    display: DISPLAY,
    thermal: null,
    config: { maxFps: 120, idleFps: 30, budgetMs: 8.33, budget: "rate", frames: 1024 },
    measured: ["gpu", "passes", "draws"],
    ...overrides
  };
}

/**
 * The header of an engine with the 0.15.x patch: the app id with the `.debug` suffix of a native
 * debug install (S-E3) and the overdraw heat map off (U6), on top of `headerLine`.
 *
 * @param overrides - Fields to replace.
 * @returns The header.
 */
export function patchedHeaderLine(overrides: Partial<FakeHeaderLine> = {}): FakeHeaderLine {
  return headerLine({
    engine: "0.15.1",
    app: { id: APP_ID },
    debug: { overdraw: false },
    ...overrides
  });
}

/**
 * A valid sample line (11:977-1004), `kept` null (no kept picture in the second).
 *
 * @param frame - The newest frame of the second.
 * @param overrides - Fields to replace (or add: `targets`, `counts` and the next change's fields).
 * @returns The sample.
 */
export function sampleLine(frame: number, overrides: Partial<FakeSampleLine> = {}): FakeSampleLine {
  const meanMax = { mean: 0.5, max: 1 };
  return {
    v: 1,
    kind: "sample",
    t: 1_760_454_001_000,
    build: null,
    frame,
    windowMs: 1000,
    path: "home",
    ticks: 60,
    frames: 60,
    drawn: 54,
    idle: 0,
    gaps: { missed: 0, drawn: 0, idle: 0 },
    gapMs: { p50: 16.7, p90: 16.9, p99: 25.1 },
    frameHist: Array.from<number>({ length: 81 }).fill(0),
    workMs: { p50: 3, p90: 4, max: 9 },
    overBudget: 1,
    phasesMs: {
      start: meanMax,
      input: meanMax,
      animate: meanMax,
      layout: meanMax,
      sync: meanMax,
      signals: meanMax,
      render: meanMax,
      agent: meanMax
    },
    systems: null,
    gpuMs: null,
    passes: null,
    draws: null,
    filters: null,
    uploads: null,
    compiles: null,
    marks: null,
    rebuilds: null,
    longFrames: null,
    heapMb: 151,
    textures: { count: 12, mb: 41.25, art: 31.5, targets: 9.75, kept: 0 },
    views: 180,
    pooled: 24,
    resolution: 2,
    monitorMs: 0.05,
    spikes: 1,
    kept: null,
    ...overrides
  };
}

/**
 * The sample of an engine with the 0.15.x patch: render-target churn (E5) and the object counters
 * (engine U3: entities, views, timers, frame listeners and a registered count), on top of
 * `sampleLine`.
 *
 * @param frame - The newest frame of the second.
 * @param overrides - Fields to replace.
 * @returns The sample.
 */
export function patchedSampleLine(
  frame: number,
  overrides: Partial<FakeSampleLine> = {}
): FakeSampleLine {
  return sampleLine(frame, {
    targets: { created: 6, destroyed: 6 },
    counts: {
      entities: 104,
      views: 180,
      timers: 3,
      frameListeners: 2,
      clockListeners: 1,
      inputListeners: 5
    },
    ...overrides
  });
}

/**
 * A valid frame record (11:1014-1027).
 *
 * @param frame - The frame number.
 * @param overrides - Fields to replace.
 * @returns The record.
 */
export function frameRecord(frame: number, overrides: Partial<FrameRecord> = {}): FrameRecord {
  return {
    frame,
    t: 40_000,
    gapMs: 41.3,
    capMs: 16.67,
    rateMs: 16.67,
    budgetMs: 16.67,
    skipped: 0,
    startMs: 0.2,
    phases: {
      input: 0.3,
      animate: 0.4,
      layout: 0.1,
      sync: 1.2,
      signals: 0.1,
      render: 5.9,
      agent: 0
    },
    workMs: 8,
    drawn: true,
    idle: false,
    stepped: false,
    reason: null,
    passes: 2,
    stencilPasses: null,
    draws: 212,
    filters: null,
    uploads: { count: 3, mb: 41 },
    compiles: 0,
    marks: null,
    rebuilds: null,
    systems: null,
    gpuMs: 6.6,
    gpuPartial: false,
    path: "garden/boss",
    changed: [{ kind: "bundle", what: "garden-boss" }],
    causes: ["upload", "gap"],
    kept: null,
    ...overrides
  };
}

/**
 * A valid spike line (11:1034-1044) around a frame record.
 *
 * @param record - The frame record.
 * @param overrides - Fields to replace.
 * @returns The spike line.
 */
export function spikeLine(
  record: FrameRecord,
  overrides: Partial<PerfSpikeLine> = {}
): PerfSpikeLine {
  return {
    v: 1,
    kind: "spike",
    t: 1_760_454_001_500,
    build: null,
    frame: record,
    systems: null,
    compiles: [],
    filters: [],
    passes: [],
    longFrames: [],
    ...overrides
  };
}

/**
 * A valid event line (11:1056).
 *
 * @param name - The event name.
 * @param frame - Its frame; null between frames.
 * @param detail - Its detail.
 * @returns The event line.
 */
export function eventLine(
  name: PerfEventName,
  frame: number | null,
  detail: Readonly<Record<string, Json>> = {}
): PerfEventLine {
  return { v: 1, kind: "event", t: 1_760_454_001_200, build: null, frame, name, detail };
}

/**
 * An event line of a name the 0.15.x patch or the next change adds (`shader`, `problem`, `debug`,
 * `gc`, `sections`), or of any older name.
 *
 * @param name - The event name.
 * @param frame - Its frame; null between frames.
 * @param detail - Its detail.
 * @returns The event line.
 */
export function nextEventLine(
  name: PerfEventNameNext,
  frame: number | null,
  detail: Readonly<Record<string, Json>> = {}
): TimelineEventLine {
  return { v: 1, kind: "event", t: 1_760_454_001_200, build: null, frame, name, detail };
}

/**
 * A valid mark line (11-monitor), as `monitor.mark(label)` writes it.
 *
 * @param label - What follows.
 * @param auto - True for the engine's own mark of a new rest path.
 * @returns The mark line.
 */
export function markLine(label: string, auto = false): PerfMarkLine {
  return { v: 1, kind: "mark", t: 1_760_454_002_000, build: null, label, auto };
}

/**
 * A valid rate change (spec 21, 21:117-129): the fall back from 120 to 60 after missed frames.
 *
 * @param overrides - Fields to replace.
 * @returns The rate change.
 */
export function rateChange(overrides: Partial<RateChange> = {}): RateChange {
  return {
    from: 120,
    to: 60,
    reason: "missed",
    mode: "auto",
    displayHz: 120,
    thermal: "none",
    window: { drawn: 41, missed: 9, heavy: 0 },
    dwellMs: 5000,
    ...overrides
  };
}

/**
 * A `rate` event line (engine lead 2026-10-16: every adaptive change is one), its detail the
 * `RateChange` and its frame the frame of the change (null between frames).
 *
 * @param overrides - Fields of the rate change to replace.
 * @param frame - The frame of the change; 4855 by default.
 * @returns The event line.
 */
export function rateLine(
  overrides: Partial<RateChange> = {},
  frame: number | null = 4855
): PerfEventLine {
  return eventLine("rate", frame, rateChange(overrides));
}

/**
 * A `display` event line (game@0fda201): the display of the default header with its refresh rate
 * learned.
 *
 * @param hz - The display's refresh rate.
 * @returns The event line.
 */
export function displayLine(hz: number | null = 120): PerfEventLine {
  return eventLine("display", null, { ...DISPLAY, hz });
}

/**
 * A `shader` event line of the 0.15.x patch (E4): a compile of `fog.blur` during a filter pass,
 * after boot. `frame` is on the line and in the detail.
 *
 * @param overrides - Fields of the detail to replace.
 * @returns The event line.
 */
export function shaderLine(overrides: Partial<ShaderEventDetail> = {}): TimelineEventLine {
  const detail: ShaderEventDetail = {
    what: "compile",
    label: "fog.blur",
    ms: 38.2,
    frame: 4851,
    boot: false,
    during: { pass: 2, filter: "fog.blur", owner: 412, view: "fogLayer" },
    ...overrides
  };
  return nextEventLine("shader", detail.frame, detail);
}

/** A still filter flagged on the fog layer, over its budget (`problem`, rule `filter-still`). */
export const FLAGGED_PROBLEM: ProblemEventDetail = {
  rule: "filter-still",
  severity: "warn",
  owner: 412,
  view: "fogLayer",
  filter: "fog.blur",
  value: 6.2,
  threshold: 2,
  since: 4802,
  frames: 53,
  reason: "budget"
};

/**
 * A `problem` event line (N3, two rules in 0.15.x): a still filter flagged on an owner and view,
 * over its budget; or the given detail (a `cleared` one, another rule).
 *
 * @param detail - The detail; `FLAGGED_PROBLEM` by default.
 * @param frame - Its frame; 4853 by default.
 * @returns The event line.
 */
export function problemLine(
  detail: ProblemEventDetail = FLAGGED_PROBLEM,
  frame: number | null = 4853
): TimelineEventLine {
  return nextEventLine("problem", frame, detail);
}

/**
 * A `gc` event line (N6, next change): fired only when the heap moved.
 *
 * @param overrides - Fields of the detail to replace.
 * @param frame - Its frame; 4818 by default.
 * @returns The event line.
 */
export function gcLine(
  overrides: Partial<GcEventDetail> = {},
  frame: number | null = 4818
): TimelineEventLine {
  const detail: GcEventDetail = { freedMb: 4.2, heapMb: 41.9, hint: true, ...overrides };
  return nextEventLine("gc", frame, detail);
}

/** A write that switched the passes and shaders sections on (`sections` event). */
export const PASSES_ON: SectionsEventDetail = { on: ["passes", "shaders"], off: [] };

/**
 * A `sections` event line (N1, next change): the sections a write switched on and off.
 *
 * @param detail - The switched sections; `PASSES_ON` by default.
 * @returns The event line, between frames.
 */
export function sectionsLine(detail: SectionsEventDetail = PASSES_ON): TimelineEventLine {
  return nextEventLine("sections", null, { on: [...detail.on], off: [...detail.off] });
}

/**
 * A `debug` event line (engine U6): the overdraw heat map turned on or off; frames drawn with it on
 * are not real cost.
 *
 * @param overdraw - The heat map is on.
 * @returns The event line, between frames.
 */
export function debugLine(overdraw = true): TimelineEventLine {
  const detail: DebugEventDetail = { overdraw };
  return nextEventLine("debug", null, detail);
}

/**
 * A per-second `passes` summary line (N4, next change): the fog layer's blur chain of the second and
 * the heaviest frame's passes.
 *
 * @param overrides - Fields to replace.
 * @returns The line.
 */
export function passesLine(overrides: Partial<PerfPassesLine> = {}): PerfPassesLine {
  return {
    v: 1,
    kind: "passes",
    t: 1_760_454_001_000,
    chains: [
      {
        owner: 412,
        view: "fogLayer",
        kinds: ["fog.blur", "fog.blur"],
        applies: 120,
        mpx: 221.2,
        draws: 4,
        gpuMs: { p50: 6.2, max: 6.9 }
      }
    ],
    heaviest: {
      frame: 4852,
      passes: [
        { index: 0, kind: "canvas", label: "main", stencil: null, w: 1080, h: 2340, gpuMs: 3.1 }
      ]
    },
    ...overrides
  };
}

/**
 * A line of a newer engine as the installed engine's listener type names it: the next change hands
 * the same listener line kinds (`passes`) and event names (`gc`, `sections`) the installed
 * `PerfLogLine` does not list yet.
 *
 * @param line - The line.
 * @returns The same line.
 */
function asStreamLine(line: FakeLogLine): PerfLogLine {
  // boundary: the engine delivers a newer line unchanged to a listener typed by the older union
  return line as PerfLogLine;
}

/**
 * The tagged error of a member that needs control (the engine's control refusal, TC §3).
 *
 * @param reason - "read-only" (a `--debug=read` build) or "dev-only" (missing from the build).
 * @param method - The member refused.
 * @returns The error.
 */
function refusal(reason: "read-only" | "dev-only", method: string): Error & { reason: string } {
  return Object.assign(
    new Error(
      `[game] monitor.${method} needs a build with control.\n  Build with moku-game build --debug.`
    ),
    { reason }
  );
}

/**
 * The remover `counts.register` answers: the fake keeps no count (perf never registers one), so
 * there is nothing to undo.
 */
function noCount(): void {}

/** The mutable ring the fake writes. */
type MutableRing = {
  capacity: number;
  size: number;
  newest: number;
  written: number;
  columns: FrameColumns;
  passes: MutablePasses;
  paths: string[];
  /** The interned filter kinds `kind2` indexes 1-based (the engine keeps them on the frame ring). */
  kindNames: string[];
  systemNames?: readonly string[];
  read: FrameRing["read"];
};

/**
 * The fake's ring as the engine's listener and `frameAt` type it. A ring modelling an older engine
 * lacks the 0.15.x pass columns and the system names the installed type requires.
 *
 * @param ring - The fake's ring.
 * @returns The same ring.
 */
function asEngineRing(ring: MutableRing): FrameRing {
  // boundary: the fake of an older engine omits columns the installed engine's ring type requires
  return ring as unknown as FrameRing;
}

/**
 * Writes the five slowest systems of a frame (the engine's `writeSystems`): every slot empty, the
 * first `sysMs` NaN without a timing table, else the given systems slowest first.
 *
 * @param c - The columns.
 * @param slot - The slot.
 * @param systems - The frame's systems, or none.
 */
function writeSystems(
  c: FrameColumns,
  slot: number,
  systems: readonly FakeSystemTime[] | undefined
): void {
  const base = slot * SYSTEMS_PER_FRAME;
  c.sysIdx.fill(NO_SYSTEM, base, base + SYSTEMS_PER_FRAME);
  c.sysMs.fill(0, base, base + SYSTEMS_PER_FRAME);
  if (systems === undefined) {
    c.sysMs[base] = Number.NaN;
    return;
  }
  for (const [place, system] of systems.slice(0, SYSTEMS_PER_FRAME).entries()) {
    c.sysIdx[base + place] = system.idx;
    c.sysMs[base + place] = system.ms;
  }
}

/**
 * Writes one frame into a slot of the columns.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @param frame - The frame number.
 * @param input - The frame's values.
 */
function writeSlot(ring: MutableRing, slot: number, frame: number, input: FakeFrame): void {
  const c = ring.columns;
  const rateMs = input.rateMs ?? 16.67;
  let pathId = ring.paths.indexOf(input.path ?? "home");
  if (pathId < 0) pathId = ring.paths.push(input.path ?? "home") - 1;
  c.frame[slot] = frame;
  c.t[slot] = input.t;
  c.gapMs[slot] = input.gapMs ?? Number.NaN;
  c.capMs[slot] = input.capMs ?? 16.67;
  c.rateMs[slot] = rateMs;
  c.budgetMs[slot] = input.budgetMs ?? rateMs;
  for (let phase = 0; phase < 6; phase += 1)
    c.phaseMs[slot * 6 + phase] = input.phaseMs?.[phase] ?? 0;
  c.agentMs[slot] = input.agentMs ?? 0;
  c.workMs[slot] = input.workMs ?? 3;
  c.drawn[slot] = input.drawn === false ? 0 : 1;
  c.idle[slot] = input.idle === true ? 1 : 0;
  c.gpuMs[slot] = input.gpuMs ?? Number.NaN;
  c.gpuPartial[slot] = input.gpuPartial === true ? 1 : 0;
  c.causes[slot] = input.causes ?? 0;
  c.changed[slot] = input.changed ?? 0;
  c.path[slot] = pathId;
  c.passes[slot] = input.passes ?? Number.NaN;
  c.draws[slot] = input.draws ?? Number.NaN;
  c.filterApplies[slot] = input.filterApplies ?? Number.NaN;
  c.filterMpx[slot] = input.filterMpx ?? Number.NaN;
  c.uploads[slot] = input.uploads ?? Number.NaN;
  c.uploadMb[slot] = input.uploadMb ?? Number.NaN;
  c.compiles[slot] = input.compiles ?? Number.NaN;
  c.marks[slot] = input.marks ?? Number.NaN;
  writeSystems(c, slot, input.systems);
  c.kept[slot] = input.kept ?? Number.NaN;
  c.retakes[slot] = input.retakes ?? Number.NaN;
  c.targetsCreated[slot] = Number.NaN;
  c.targetsDestroyed[slot] = Number.NaN;
  c.reason[slot] = input.reason ?? 255;
}

/**
 * The 1-based `kind2` of a filter kind name (0 for none), interned into `kindNames` like the
 * engine's sinks.
 *
 * @param kindNames - The interned names.
 * @param filter - The filter kind's name, or none.
 * @returns The `kind2` byte.
 */
function kind2Of(kindNames: string[], filter: string | null | undefined): number {
  if (filter === null || filter === undefined) return 0;
  const known = kindNames.indexOf(filter);
  return (known === -1 ? kindNames.push(filter) - 1 : known) + 1;
}

/**
 * Writes the 0.15.x columns of one pass, when the ring has them.
 *
 * @param ring - The ring: its pass ring and the kind names on the frame ring.
 * @param slot - The slot.
 * @param pass - The pass.
 */
function writePassColumns(ring: MutableRing, slot: number, pass: FakePass): void {
  const { owner, kind2, drawsAt, format, resolution } = ring.passes;
  if (owner !== undefined) owner[slot] = pass.owner ?? 0;
  if (kind2 !== undefined) kind2[slot] = kind2Of(ring.kindNames, pass.filter);
  if (drawsAt !== undefined) drawsAt[slot] = pass.drawsAt ?? 0;
  if (format !== undefined) format[slot] = pass.format ?? null;
  if (resolution !== undefined) resolution[slot] = pass.resolution ?? Number.NaN;
}

/**
 * A number of a typed-array cell, `null` for NaN or a cell that does not exist.
 *
 * @param column - The column, or none.
 * @param slot - The slot.
 * @returns The value.
 */
function measuredAt(column: ArrayLike<number> | undefined, slot: number): number | null {
  const value = column?.[slot];
  return value === undefined || Number.isNaN(value) ? null : value;
}

/**
 * The passes of the frames `frames` still in the pass ring, oldest first, as `detail` answers them.
 *
 * @param ring - The ring: its pass ring and the kind names on the frame ring.
 * @param frames - The frame numbers asked for.
 * @returns The pass records.
 */
function detailPasses(ring: MutableRing, frames: ReadonlySet<number>): FakeDetailPass[] {
  const { passes } = ring;
  const found: FakeDetailPass[] = [];
  for (let age = passes.size - 1; age >= 0; age -= 1) {
    const slot = (passes.newest - age + passes.capacity) % passes.capacity;
    const frame = passes.frame[slot] ?? 0;
    if (!frames.has(frame)) continue;
    const stencil = passes.stencil[slot] ?? NO_STENCIL;
    const kind2 = passes.kind2?.[slot] ?? 0;
    found.push({
      frame,
      index: passes.index[slot] ?? 0,
      kind: PASS_KIND_NAMES[passes.kind[slot] ?? 0] ?? "texture",
      label: passes.label[slot] ?? null,
      stencil: stencil === NO_STENCIL ? null : stencil === 1,
      w: passes.width[slot] ?? 0,
      h: passes.height[slot] ?? 0,
      gpuMs: measuredAt(passes.gpuMs, slot),
      owner: passes.owner === undefined ? null : (passes.owner[slot] ?? 0) || null,
      filter: kind2 === 0 ? null : (ring.kindNames[kind2 - 1] ?? null),
      drawsAt: measuredAt(passes.drawsAt, slot),
      format: passes.format?.[slot] ?? null,
      resolution: measuredAt(passes.resolution, slot)
    });
  }
  return found;
}

/**
 * The five slowest systems of each held slot (rows × 5, `idx` −1 for an empty slot), or null on a
 * ring without names.
 *
 * @param ring - The ring.
 * @param slots - The slots of the frames, oldest first.
 * @returns The systems block.
 */
function detailSystems(ring: MutableRing, slots: readonly number[]): FakeDetail["systems"] {
  const names = ring.systemNames;
  if (names === undefined) return null;
  const idx: number[] = [];
  const ms: number[] = [];
  for (const slot of slots) {
    for (let place = 0; place < SYSTEMS_PER_FRAME; place += 1) {
      const at = slot * SYSTEMS_PER_FRAME + place;
      const index = ring.columns.sysIdx[at] ?? NO_SYSTEM;
      idx.push(index === NO_SYSTEM ? -1 : index);
      ms.push(index === NO_SYSTEM ? 0 : (ring.columns.sysMs[at] ?? 0));
    }
  }
  return { names: [...names], idx, ms };
}

/**
 * Creates the fake monitor of 11-monitor.
 *
 * @param options - Capacity, header, whether the ring has a `budgetMs` column, the 0.15.x pass
 *   columns, how `systemNames` grows, and the next change's `sections` / `detail`.
 * @returns The fake.
 */
export function createFakeMonitor(options: FakeMonitorOptions = {}): FakeMonitor {
  const capacity = options.capacity ?? 64;
  const header = options.header === undefined ? headerLine() : options.header;
  const budgetColumn = options.budgetColumn !== false;
  const legacyReset = options.legacyReset === true;
  const namesGrow = options.systemNames ?? "copy";
  const sectionsMode = options.sections ?? "control";
  const detailMode = options.detail ?? "control";
  const result = { copied: 0, lost: 0 };
  const listeners = new Set<(line: PerfLogLine) => void>();
  let lastFrame = 0;
  let passFrame = -1;
  let passIndex = -1;
  let agentOpen = false;
  let grownNames: string[] = [];
  let sections: MonitorSections = Object.freeze({ ...(header?.sections ?? SECTION_DEFAULTS) });

  const ring: MutableRing = {
    capacity,
    size: 0,
    newest: -1,
    written: 0,
    columns: createColumns(capacity),
    passes: createPasses(capacity * PASSES_PER_FRAME, options.passColumns !== false),
    paths: ["…"],
    kindNames: [],
    ...(namesGrow === "none" ? {} : { systemNames: grownNames }),
    read: (into, since) => {
      fake.reads += 1;
      if (fake.failRead !== undefined) throw fake.failRead;
      const available = Math.max(0, ring.written - since);
      const count = Math.min(available, ring.size, Math.max(0, into.length));
      result.copied = count;
      result.lost = available - count;
      const oldest = (ring.newest - count + 1 + capacity) % capacity;
      for (const name of COLUMN_NAMES) {
        const target = into[name];
        if (target === undefined || (name === "budgetMs" && !budgetColumn)) continue;
        const stride = STRIDES[name];
        const source = ring.columns[name];
        for (let index = 0; index < count; index += 1) {
          const slot = (oldest + index) % capacity;
          for (let value = 0; value < stride; value += 1) {
            target[index * stride + value] = source[slot * stride + value] ?? Number.NaN;
          }
        }
      }
      return result;
    }
  };

  /**
   * `monitor.sections(next?)`: a read answers the sections; a write merges the given keys, emits a
   * `sections` event of what switched and answers the new sections, or throws the tagged refusal
   * without control.
   *
   * @param next - The sections to switch; undefined to read.
   * @returns The sections now.
   */
  const readOrWriteSections = (next?: Partial<MonitorSections>): MonitorSections => {
    fake.controlCalls.push({ method: "sections", input: next, inAgent: agentOpen });
    if (next === undefined) return sections;
    if (sectionsMode === "read-only" || sectionsMode === "dev-only") {
      throw refusal(sectionsMode, "sections");
    }
    const on: MonitorSectionName[] = [];
    const off: MonitorSectionName[] = [];
    for (const name of MONITOR_SECTIONS) {
      const value = next[name];
      if (value === undefined || value === sections[name]) continue;
      (value ? on : off).push(name);
    }
    sections = Object.freeze({ ...sections, ...next });
    if (on.length + off.length > 0) fake.emit(sectionsLine({ on, off }));
    return sections;
  };

  /**
   * `monitor.detail({ from, to })`: the frames of the range still held, their passes and systems;
   * the tagged refusal without control.
   *
   * @param range - The frames asked for (either order).
   * @param range.from - One end of the range.
   * @param range.to - The other end.
   * @returns The answer.
   */
  const detailOf = (range: { readonly from: number; readonly to: number }): FakeDetail => {
    fake.controlCalls.push({ method: "detail", input: range, inAgent: agentOpen });
    if (detailMode === "read-only" || detailMode === "dev-only")
      throw refusal(detailMode, "detail");
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    const frames: FrameRecord[] = [];
    const slots: number[] = [];
    for (let age = ring.size - 1; age >= 0; age -= 1) {
      const record = frameAt(asEngineRing(ring), age);
      if (record === undefined || record.frame < from || record.frame > to) continue;
      frames.push(record);
      slots.push((ring.newest - age + capacity) % capacity);
    }
    const first = frames[0];
    const last = frames.at(-1);
    return {
      from,
      to,
      held:
        first === undefined || last === undefined ? null : { from: first.frame, to: last.frame },
      frames,
      passes: detailPasses(ring, new Set(frames.map(record => record.frame))),
      systems: frames.length === 0 ? null : detailSystems(ring, slots),
      marks: null
    };
  };

  const fake: FakeMonitor = {
    ring,
    begins: 0,
    ends: 0,
    reads: 0,
    marks: [],
    events: [],
    controlCalls: [],
    get listeners() {
      return listeners.size;
    },
    failRead: undefined,
    stream: listener => {
      listeners.add(listener);
      if (header !== null) listener(deepFreeze(structuredClone(header)));
      return () => {
        listeners.delete(listener);
      };
    },
    frames: () => asEngineRing(ring),
    counts: { register: () => noCount },
    mark: label => {
      fake.marks.push(label);
      fake.emit(markLine(label));
    },
    event: (name, detail = {}) => {
      fake.events.push({ name, detail });
      fake.emit(eventLine(name, null, detail));
    },
    beginAgent: () => {
      fake.begins += 1;
      agentOpen = true;
    },
    endAgent: () => {
      fake.ends += 1;
      agentOpen = false;
    },
    setResolution: resolution => resolution ?? 2,
    commit: input => {
      if (capacity === 0) throw new Error("fake-monitor: a ring of capacity 0 commits nothing");
      const frame = input.frame ?? lastFrame + 1;
      lastFrame = frame;
      const slot = legacyReset ? (ring.newest + 1) % capacity : ring.written % capacity;
      writeSlot(ring, slot, frame, input);
      ring.newest = slot;
      ring.size = Math.min(ring.size + 1, capacity);
      ring.written += 1;
      return frame;
    },
    landGpu: (frame, gpuMs, causes = 0) => {
      for (let slot = 0; slot < capacity; slot += 1) {
        if (ring.columns.frame[slot] !== frame) continue;
        ring.columns.gpuMs[slot] = gpuMs;
        ring.columns.gpuPartial[slot] = 0;
        ring.columns.causes[slot] = (ring.columns.causes[slot] ?? 0) | causes;
        return true;
      }
      return false;
    },
    commitPass: (pass = {}) => {
      const { passes } = ring;
      if (passes.capacity === 0)
        throw new Error("fake-monitor: a ring of capacity 0 commits no pass");
      const frame = pass.frame ?? lastFrame;
      passIndex = pass.index ?? (frame === passFrame ? passIndex + 1 : 0);
      passFrame = frame;
      const sequence = passes.written;
      const slot = sequence % passes.capacity;
      passes.frame[slot] = frame;
      passes.index[slot] = passIndex;
      passes.kind[slot] = PASS_KIND_BYTE[pass.kind ?? "canvas"];
      passes.stencil[slot] = pass.stencil === undefined ? NO_STENCIL : Number(pass.stencil);
      passes.width[slot] = pass.w ?? 1080;
      passes.height[slot] = pass.h ?? 2340;
      passes.gpuMs[slot] = pass.gpuMs ?? Number.NaN;
      passes.label[slot] = pass.label ?? null;
      writePassColumns(ring, slot, pass);
      passes.newest = slot;
      passes.size = Math.min(passes.size + 1, passes.capacity);
      passes.written = sequence + 1;
      return sequence;
    },
    landPassGpu: (sequence, gpuMs) => {
      const { passes } = ring;
      if (
        sequence < 0 ||
        sequence >= passes.written ||
        passes.written - sequence > passes.capacity
      ) {
        return false;
      }
      passes.gpuMs[sequence % passes.capacity] = gpuMs;
      return true;
    },
    addSystem: name => {
      if (namesGrow === "none") {
        throw new Error('fake-monitor: a ring with systemNames "none" has no names');
      }
      const index = grownNames.length;
      if (namesGrow === "copy") {
        grownNames = [...grownNames, name];
        ring.systemNames = grownNames;
      } else {
        grownNames.push(name);
      }
      return index;
    },
    restart: () => {
      ring.size = 0;
      ring.newest = -1;
    },
    emit: line => {
      const frozen = asStreamLine(deepFreeze(line));
      for (const listener of listeners) listener(frozen);
    },
    ...(sectionsMode === "absent" ? {} : { sections: readOrWriteSections }),
    ...(detailMode === "absent" ? {} : { detail: detailOf })
  };
  return fake;
}
