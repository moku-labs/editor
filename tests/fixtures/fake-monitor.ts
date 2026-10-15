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
 */
import type {
  FrameColumns,
  FrameRecord,
  FrameRing,
  MonitorLike,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfHeaderLine,
  PerfLogLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  RateChange
} from "../../src/plugins/perf/protocol";
import type { Json } from "../../src/plugins/registry/protocol";

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
  /** The draw reason of spec 14; 255 (not measured) by default. */
  readonly reason?: number;
};

/** How to build a fake monitor. */
export type FakeMonitorOptions = {
  /** Ring capacity; 0 = a build without the agent flag (or a renderer not attached yet). 64 by default. */
  readonly capacity?: number;
  /** The header delivered at subscribe; `null` for none. A default header by default. */
  readonly header?: PerfHeaderLine | null;
  /** False: the ring has no `budgetMs` column (an engine before the 11-monitor addendum). */
  readonly budgetColumn?: boolean;
  /**
   * True: the ring of an engine before fix A: after `restart()` the next frame goes to slot 0
   * (`(newest + 1) % capacity`), not to `written % capacity`.
   */
  readonly legacyReset?: boolean;
};

/** A monitor event the fake recorded. */
export type FakeEvent = {
  readonly name: PerfEventName;
  readonly detail: Readonly<Record<string, Json>>;
};

/** The fake monitor: a `MonitorLike` plus the test's controls and records. */
export type FakeMonitor = MonitorLike & {
  /** The ring `frames()` answers (the same object every call). */
  readonly ring: FrameRing;
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
  /** Delivers a line to every listener, deeply frozen. */
  emit(line: PerfLogLine): void;
  /**
   * Resets the ring the way the engine's stop does (`stopPerf`): `size` 0 and `newest` -1, `written`
   * kept. The next frame k goes to slot `k % capacity` (engine fix A), or to slot 0 with `legacyReset`.
   */
  restart(): void;
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
  retakes: 1
};

/** The column names in a fixed order. */
const COLUMN_NAMES = Object.keys(STRIDES) as (keyof FrameColumns)[];

/**
 * Allocates the 35 columns of a ring of `capacity` frames.
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
    sysIdx: new Uint16Array(capacity * 5),
    sysMs: new Float32Array(capacity * 5),
    fltKind: new Uint8Array(capacity * 4),
    fltApplies: new Uint16Array(capacity * 4),
    fltMpx: new Float32Array(capacity * 4),
    kept: new Float32Array(capacity).fill(Number.NaN),
    retakes: new Float32Array(capacity).fill(Number.NaN)
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

/** The display of the default header: a Samsung A26 in portrait. */
export const DISPLAY: PerfDisplay = {
  dpr: 2.81,
  resolution: 2,
  maxResolution: 2,
  canvas: { w: 1080, h: 2340 },
  css: { w: 540, h: 1170 },
  safeArea: { t: 32, r: 0, b: 24, l: 0 },
  backend: "webgpu",
  orientation: "portrait"
};

/**
 * A valid header line (11:944-958): a debug build on a phone at 120 fps, budget "rate", with a GPU
 * timer and no `rate` key (a block-2b engine).
 *
 * @param overrides - Fields to replace.
 * @returns The header.
 */
export function headerLine(overrides: Partial<PerfHeaderLine> = {}): PerfHeaderLine {
  return {
    v: 1,
    kind: "header",
    t: 1_760_454_000_000,
    build: "debug-20261014T160000Z",
    timeOrigin: 1_760_453_960_000,
    engine: "0.14.12+9c41e0",
    device: {
      userAgent: "Mozilla/5.0 (Linux; Android 15; SM-A266B)",
      model: "SM-A266B",
      modelFrom: "ua",
      webview: "Chrome 141",
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
 * A valid sample line (11:977-1004), `kept` null (no kept picture in the second).
 *
 * @param frame - The newest frame of the second.
 * @param overrides - Fields to replace.
 * @returns The sample.
 */
export function sampleLine(frame: number, overrides: Partial<PerfSampleLine> = {}): PerfSampleLine {
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

/** The mutable ring the fake writes. */
type MutableRing = {
  capacity: number;
  size: number;
  newest: number;
  written: number;
  columns: FrameColumns;
  passes: FrameRing["passes"];
  paths: string[];
  read: FrameRing["read"];
};

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
  c.sysMs[slot * 5] = Number.NaN;
  c.kept[slot] = input.kept ?? Number.NaN;
  c.retakes[slot] = input.retakes ?? Number.NaN;
  c.reason[slot] = input.reason ?? 255;
}

/**
 * Creates the fake monitor of 11-monitor.
 *
 * @param options - Capacity, header, whether the ring has a `budgetMs` column.
 * @returns The fake.
 */
export function createFakeMonitor(options: FakeMonitorOptions = {}): FakeMonitor {
  const capacity = options.capacity ?? 64;
  const header = options.header === undefined ? headerLine() : options.header;
  const budgetColumn = options.budgetColumn !== false;
  const legacyReset = options.legacyReset === true;
  const result = { copied: 0, lost: 0 };
  const listeners = new Set<(line: PerfLogLine) => void>();
  let lastFrame = 0;

  const ring: MutableRing = {
    capacity,
    size: 0,
    newest: -1,
    written: 0,
    columns: createColumns(capacity),
    passes: {
      capacity: capacity * 4,
      size: 0,
      newest: -1,
      written: 0,
      frame: new Uint32Array(capacity * 4),
      index: new Uint8Array(capacity * 4),
      kind: new Uint8Array(capacity * 4),
      stencil: new Uint8Array(capacity * 4),
      width: new Uint16Array(capacity * 4),
      height: new Uint16Array(capacity * 4),
      gpuMs: new Float32Array(capacity * 4),
      label: []
    },
    paths: ["…"],
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

  const fake: FakeMonitor = {
    ring,
    begins: 0,
    ends: 0,
    reads: 0,
    marks: [],
    events: [],
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
    frames: () => ring,
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
    },
    endAgent: () => {
      fake.ends += 1;
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
    restart: () => {
      ring.size = 0;
      ring.newest = -1;
    },
    emit: line => {
      const frozen = deepFreeze(line);
      for (const listener of listeners) listener(frozen);
    }
  };
  return fake;
}
