/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import type { DeviceDirectory, DeviceTelemetry } from "../../connect/protocol";
import type { SessionDevice } from "../../hub/protocol";
import type {
  PerfDetailWire,
  PerfEventsWire,
  PerfFramesWire,
  PerfPassesWire,
  PerfPassRowsWire,
  PerfSampleLine,
  PerfSecond,
  PerfTimelineLine,
  RestState
} from "../../perf/protocol";
import { SECTION_DEFAULTS } from "../../perf/protocol";
import type { RecorderSource, RecorderStatus } from "../../recorder/protocol";
import type { Json, Manifest, SessionInfo } from "../../registry/protocol";
import { bitsOf, EPOCH, line, TIME_ORIGIN } from "./mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The design's demo phone for Mission control (spec 09 § M9 "Demo values",
// concept-spec "Demo data"): a Galaxy A26 by wire running A Memory Missing. Its
// frames repeat a 360-frame loop from f4601 — the spikes f4802 (JS 22.4 ms),
// f4851–4853 (GPU sustained), f4890 (shader compile 31 ms), a 1.4 s rest at
// 30 fps, GCs at f4818 / f4866 / f4931, adaptive 120 → 60 at f4855 and back at
// f4930 — with its events, seconds, passes, range detail, recording, wired
// telemetry (heap sawtooth 27–57 MB, +1.8 MB/min; CPU 27 / 35 / 11 % of 8 cores;
// GPU 64 % busy at 585 MHz, 221–949 MHz; PSS 541 / 424 MB) and scene values.
// Read by integration/mission-control.test.ts and by M4's fake device
// (spec 10 Delta 2026-10-16b), which answers reads by `after` from them: the
// file is runtime-free (no DOM, no plugin instance).
//
// The first part keeps the shapes the unit tests use (DEVICE, sampleOf,
// secondOf, recorderOf).
// ─────────────────────────────────────────────────────────────────────────────

/** The phone of the design: an A26 over adb. */
export const DEVICE: SessionDevice = {
  id: "d-7f3a",
  model: "SM-A266B",
  link: "adb",
  address: "127.0.0.1",
  port: 47_600,
  engine: "0.14.12+9c41e0",
  build: "debug-20261014T160000Z"
};

/** The first and the last frame of a 6 s window at 60 fps the unit tests' samples name. */
const SAMPLE_FRAME = 4845;

/**
 * A sample line of the engine (11-monitor).
 *
 * @param overrides - Field overrides.
 * @returns The sample.
 */
export function sampleOf(overrides: Partial<PerfSampleLine> = {}): PerfSampleLine {
  const meanMax = { mean: 0, max: 0 };
  return {
    v: 1,
    kind: "sample",
    t: 46_000,
    build: DEVICE.build,
    frame: SAMPLE_FRAME,
    windowMs: 1000,
    path: "garden/boss",
    ticks: 60,
    frames: 60,
    drawn: 54,
    idle: 0,
    gaps: { missed: 2, drawn: 54, idle: 0 },
    gapMs: { p50: 16.7, p90: 18.2, p99: 41 },
    frameHist: [],
    workMs: { p50: 6, p90: 9, max: 30 },
    overBudget: 6,
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
    systems: [
      { name: "ripple", mean: 1.4, max: 2 },
      { name: "frost-apply", mean: 2.1, max: 3 },
      { name: "pathing", mean: 0.2, max: 1 },
      { name: "glass", mean: 0.9, max: 1 }
    ],
    gpuMs: { p50: 5, p90: 7, max: 9, frames: 54 },
    passes: { mean: 6.2, max: 9, stencil: null },
    draws: { mean: 211.6, max: 260 },
    filters: { applies: { mean: 4, max: 6 }, mpx: 2.1 },
    uploads: null,
    compiles: null,
    marks: null,
    rebuilds: null,
    longFrames: null,
    heapMb: 151.3,
    textures: { count: 40, mb: 130, art: 96, targets: 32, kept: 0 },
    views: 1384,
    pooled: 24,
    resolution: 1,
    monitorMs: 0.2,
    spikes: 6,
    kept: null,
    ...overrides
  };
}

/**
 * An `editor.perf.second` value of a phone (the unit tests' shape: 60 fps on a 60 Hz display).
 *
 * @param overrides - Field overrides.
 * @returns The value.
 */
export function secondOf(overrides: Partial<PerfSecond> = {}): PerfSecond {
  return {
    state: "on",
    fps: { loop: 60, drawn: 54 },
    spikes: 6,
    budgetMs: 16.7,
    rate: { fps: 60, mode: "auto", reason: "start", displayHz: 60, switches: 0 },
    render: { passesMax: 3, kept: { pictures: 4, mb: 1.4, retakes: 0 }, redraws: 0, rebuilds: 0 },
    sample: sampleOf(),
    display: {
      dpr: 2.8125,
      resolution: 1,
      maxResolution: 1,
      canvas: { w: 1080, h: 2340 },
      css: { w: 384, h: 832 },
      safeArea: { t: 32, r: 0, b: 24, l: 0 },
      backend: "webgpu",
      orientation: "portrait"
    },
    device: {
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; SM-A266B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36",
      model: "SM-A266B",
      modelFrom: "ua",
      webview: "131",
      cores: 8,
      memoryGb: 6
    },
    gpu: {
      backend: "webgpu",
      vendor: null,
      architecture: null,
      renderer: null,
      timer: "timestamp-query"
    },
    build: DEVICE.build,
    engine: DEVICE.engine,
    ...overrides
  };
}

/**
 * An `editor.recorder` status (without marks).
 *
 * @param overrides - Field overrides.
 * @returns The status.
 */
export function recorderOf(overrides: Partial<RecorderStatus> = {}): RecorderStatus {
  return {
    state: "recording",
    lines: 1840,
    bytes: 412_000,
    sent: 1790,
    pending: 50,
    monitor: true,
    file: "perf-20261014-1532-sm-a266b.jsonl",
    label: null,
    sinceMs: 192_000,
    storage: "opfs",
    dropped: 0,
    startedBy: { by: "editor", name: null },
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The demo series.
// ─────────────────────────────────────────────────────────────────────────────

/** The demo's session id on the hub. */
export const DEMO_SESSION = "s-9";

/** The demo page's epoch (header.timeOrigin as text) and its number. */
export const DEMO_EPOCH = EPOCH;
export const DEMO_TIME_ORIGIN = TIME_ORIGIN;

/** The first frame of the demo and the frames of its loop. */
export const DEMO_FIRST = 4601;
export const DEMO_LOOP = 360;

/** Page-clock ms of the demo's first frame. */
export const DEMO_T0 = 10_000;

/** The demo's spike frames (loop 0) and their causes. */
export const DEMO_SPIKES = [
  { from: 4802, to: 4802, cause: "js" },
  { from: 4851, to: 4853, cause: "gpu" },
  { from: 4890, to: 4890, cause: "compile" }
] as const;

/** The demo's GC frames (loop 0) and the MB they freed. */
export const DEMO_GCS = [
  { frame: 4818, freedMb: 4.2, pauseMs: 6 },
  { frame: 4866, freedMb: 3.8, pauseMs: 5 },
  { frame: 4931, freedMb: 5.1, pauseMs: 7 }
] as const;

/** The resting stretch of the loop (indexes, inclusive): 42 frames at 30 fps, 1.4 s. */
const REST_FROM = 40;
const REST_TO = 81;

/** The loop indexes where adaptive drops 120 → 60 (missed frames) and rises back. */
const DROP_AT = 254;
const RISE_AT = 329;

/** The spikes by loop index: JS and GPU ms and the cause. */
const SPIKES: ReadonlyMap<number, { js: number; gpu: number; cause: "js" | "gpu" | "compile" }> =
  new Map([
    [201, { js: 19.6, gpu: 2.8, cause: "js" }],
    [250, { js: 3.2, gpu: 14.8, cause: "gpu" }],
    [251, { js: 3.4, gpu: 16.1, cause: "gpu" }],
    [252, { js: 3.6, gpu: 17.4, cause: "gpu" }],
    [289, { js: 6.2, gpu: 24.8, cause: "compile" }]
  ]);

/** The GCs by loop index. */
const GCS: ReadonlyMap<number, { freedMb: number; pauseMs: number }> = new Map([
  [217, { freedMb: 4.2, pauseMs: 6 }],
  [265, { freedMb: 3.8, pauseMs: 5 }],
  [330, { freedMb: 5.1, pauseMs: 7 }]
]);

/** The systems of the demo and their share of a frame's JS. */
const SYSTEMS: readonly (readonly [string, number])[] = [
  ["ward.update", 0.38],
  ["fog.render", 0.26],
  ["renderer.sync", 0.15],
  ["ui.solve", 0.06],
  ["physics.step", 0.05]
];

/**
 * A deterministic number in [0, 1) of a frame and a salt.
 *
 * @param n - The frame.
 * @param salt - What the number is for.
 * @returns The number.
 */
function noise(n: number, salt: number): number {
  let x = (n * 2_654_435_761 + salt * 40_503) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c_1b_3c_6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x29_7a_2d_39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4_294_967_296;
}

/**
 * The gap after a frame of the loop: 33.3 ms resting, 16.7 ms at 60 fps, else 8.3 ms (120 fps).
 *
 * @param index - The loop index.
 * @returns ms.
 */
function stepOf(index: number): number {
  if (index >= REST_FROM && index <= REST_TO) return 1000 / 30;
  return index >= DROP_AT && index < RISE_AT ? 1000 / 60 : 1000 / 120;
}

/** Page-clock ms of each loop index from the loop's start, and the loop's length. */
const STARTS: readonly number[] = (() => {
  const starts: number[] = [];
  let t = 0;
  for (let index = 0; index <= DEMO_LOOP; index += 1) {
    starts.push(t);
    t += stepOf(index);
  }
  return starts;
})();

/** One loop's length, ms. */
const LOOP_MS = STARTS[DEMO_LOOP] ?? 0;

/**
 * The loop and the index of a frame.
 *
 * @param frame - The frame.
 * @returns The loop number and the index in it.
 */
function placeOf(frame: number): { loop: number; index: number } {
  const offset = frame - DEMO_FIRST;
  const loop = Math.floor(offset / DEMO_LOOP);
  return { loop, index: offset - loop * DEMO_LOOP };
}

/**
 * Page-clock ms of a frame's start.
 *
 * @param frame - The frame.
 * @returns ms.
 * @example
 * ```ts
 * demoTime(4601); // 10 000
 * ```
 */
export function demoTime(frame: number): number {
  const { loop, index } = placeOf(frame);
  return DEMO_T0 + loop * LOOP_MS + (STARTS[index] ?? 0);
}

/**
 * The newest frame that started at or before a page time (the fake device's "now").
 *
 * @param pageMs - Page-clock ms.
 * @returns The frame; DEMO_FIRST before the first.
 * @example
 * ```ts
 * demoFrameAt(10_000); // 4601
 * ```
 */
export function demoFrameAt(pageMs: number): number {
  if (pageMs <= DEMO_T0) return DEMO_FIRST;
  const loop = Math.floor((pageMs - DEMO_T0) / LOOP_MS);
  const within = pageMs - DEMO_T0 - loop * LOOP_MS;
  let index = 0;
  while (index + 1 < DEMO_LOOP && (STARTS[index + 1] ?? 0) <= within) index += 1;
  return DEMO_FIRST + loop * DEMO_LOOP + index;
}

/** One frame of the demo, as the frames feed carries it. */
export type DemoRow = {
  readonly frame: number;
  readonly t: number;
  readonly ms: number;
  readonly jsMs: number;
  readonly gpuMs: number;
  readonly rateMs: number;
  readonly budgetMs: number;
  readonly rest: RestState;
  readonly causes: number;
  readonly draws: number;
  /** The five systems of the frame and their ms. */
  readonly systems: readonly (readonly [string, number])[];
  /** The passes of the frame: view, kind, filter, GPU ms. */
  readonly passes: readonly {
    readonly view: string;
    readonly kind: "canvas" | "texture" | "filter";
    readonly filter: string | null;
    readonly gpuMs: number;
  }[];
};

/**
 * The work of a frame: JS, GPU and the GC pause, and its causes.
 *
 * @param frame - The frame.
 * @param index - Its loop index.
 * @returns The parts.
 */
function workOf(
  frame: number,
  index: number
): { js: number; gpu: number; pause: number; causes: number } {
  const a = noise(frame, 1);
  const b = noise(frame, 2);
  if (index >= REST_FROM && index <= REST_TO) {
    return { js: 0.5 + a * 0.6, gpu: 0.4 + b * 0.5, pause: 0, causes: 0 };
  }
  const spike = SPIKES.get(index);
  if (spike !== undefined) {
    return { js: spike.js, gpu: spike.gpu, pause: 0, causes: bitsOf(spike.cause) };
  }
  const gc = GCS.get(index);
  if (gc !== undefined) {
    return { js: 2.4 + a * 0.8, gpu: 2.2 + b * 0.8, pause: gc.pauseMs, causes: bitsOf("gc?") };
  }
  return { js: 2 + a * 2, gpu: 1.5 + b * 1.5, pause: 0, causes: 0 };
}

/**
 * The passes of a frame: main 45 %, the fog chain (blur 20 %, colorMatrix 10 %; most of a GPU
 * spike), bloom 15 %, hud 10 % of its GPU.
 *
 * @param gpu - The frame's GPU ms.
 * @param spike - The frame is a GPU-heavy spike.
 * @returns The passes.
 */
function passesOf(gpu: number, spike: boolean): DemoRow["passes"] {
  const share = spike ? [0.2, 0.55, 0.15, 0.06, 0.04] : [0.45, 0.2, 0.1, 0.15, 0.1];
  return [
    { view: "main", kind: "canvas", filter: null, gpuMs: gpu * (share[0] ?? 0) },
    { view: "fogLayer", kind: "filter", filter: "fog.blur", gpuMs: gpu * (share[1] ?? 0) },
    { view: "fogLayer", kind: "filter", filter: "colorMatrix", gpuMs: gpu * (share[2] ?? 0) },
    { view: "bloom", kind: "texture", filter: null, gpuMs: gpu * (share[3] ?? 0) },
    { view: "hud", kind: "canvas", filter: null, gpuMs: gpu * (share[4] ?? 0) }
  ];
}

/**
 * The draw calls of a frame: 14–19 resting, 48–66 awake, 6 more in a spike.
 *
 * @param frame - The frame.
 * @param resting - It rested.
 * @param spike - It is a spike.
 * @returns The draws.
 */
function drawsOf(frame: number, resting: boolean, spike: boolean): number {
  if (resting) return 14 + Math.round(noise(frame, 3) * 5);
  const extra = spike ? 6 : 0;
  return 48 + Math.round(noise(frame, 3) * 18) + extra;
}

/**
 * One frame of the demo.
 *
 * @param frame - The frame (DEMO_FIRST or later).
 * @returns The row.
 * @example
 * ```ts
 * demoRow(4802).causes; // the JS spike's bit
 * ```
 */
export function demoRow(frame: number): DemoRow {
  const { index } = placeOf(frame);
  const step = stepOf(index);
  const resting = index >= REST_FROM && index <= REST_TO;
  const work = workOf(frame, index);
  const ms = resting ? step : work.js + work.gpu + work.pause;
  const spike = work.causes !== 0 && GCS.get(index) === undefined;
  const systems = SYSTEMS.map(([name, share]): readonly [string, number] => {
    if (spike && name === "ward.update" && SPIKES.get(index)?.cause === "js")
      return [name, work.js];
    if (spike && name === "fog.render" && SPIKES.get(index)?.cause !== "js") {
      return [name, work.gpu * 0.81];
    }
    return [name, work.js * share];
  });
  return {
    frame,
    t: demoTime(frame),
    ms: Math.round(ms * 100) / 100,
    jsMs: Math.round(work.js * 100) / 100,
    gpuMs: Math.round(work.gpu * 100) / 100,
    rateMs: step,
    budgetMs: step,
    rest: resting ? 1 : 0,
    causes: work.causes,
    draws: drawsOf(frame, resting, spike),
    systems,
    passes: passesOf(work.gpu, spike && SPIKES.get(index)?.cause !== "js")
  };
}

/** The most frames one read answers (perf's detail clamp). */
const MAX_FRAMES = 2048;

/** The target of each pass view: its size, format, draws and owner. */
const TARGETS: Readonly<
  Record<
    string,
    { w: number; h: number; format: string | null; draws: number; owner: number | null }
  >
> = {
  main: { w: 1080, h: 2340, format: null, draws: 41, owner: null },
  fogLayer: { w: 1280, h: 720, format: "rgba8unorm", draws: 1, owner: 412 },
  bloom: { w: 640, h: 360, format: "rgba8unorm", draws: 3, owner: null },
  hud: { w: 1080, h: 2340, format: null, draws: 9, owner: null }
};

/**
 * The pass rows of rows, as a wire.
 *
 * @param rows - The frames.
 * @returns The pass columns.
 */
function passRowsOf(rows: readonly DemoRow[]): PerfPassRowsWire {
  const wire: PerfPassRowsWire = {
    row: [],
    index: [],
    kind: [],
    view: [],
    owner: [],
    filter: [],
    w: [],
    h: [],
    format: [],
    resolution: [],
    draws: [],
    gpuMs: []
  };
  for (const [rowIndex, row] of rows.entries()) {
    for (const [index, pass] of row.passes.entries()) {
      const target = TARGETS[pass.view] ?? TARGETS.main;
      wire.row.push(rowIndex);
      wire.index.push(index);
      wire.kind.push(pass.kind);
      wire.view.push(pass.view);
      wire.owner.push(target?.owner ?? null);
      wire.filter.push(pass.filter);
      wire.w.push(target?.w ?? 1080);
      wire.h.push(target?.h ?? 2340);
      wire.format.push(target?.format ?? null);
      wire.resolution.push(1);
      wire.draws.push(target?.draws ?? 1);
      wire.gpuMs.push(Math.round(pass.gpuMs * 100) / 100);
    }
  }
  return wire;
}

/**
 * The frames wire of frames `from`..`to` (inclusive), with draws, systems, nodes and passes.
 *
 * @param from - The first frame.
 * @param to - The last frame.
 * @returns The wire.
 */
function framesWireOf(from: number, to: number): PerfFramesWire {
  const rows: DemoRow[] = [];
  for (let frame = Math.max(from, DEMO_FIRST); frame <= to; frame += 1) rows.push(demoRow(frame));
  const t0 = rows[0]?.t ?? 0;
  const names = SYSTEMS.map(([name]) => name);
  return {
    v: 1,
    epoch: DEMO_EPOCH,
    t0,
    hole: false,
    gpuTimer: true,
    frame: rows.map(row => row.frame),
    t: rows.map(row => row.t - t0),
    ms: rows.map(row => row.ms),
    jsMs: rows.map(row => row.jsMs),
    gpuMs: rows.map(row => row.gpuMs),
    rateMs: rows.map(row => row.rateMs),
    budgetMs: rows.map(row => row.budgetMs),
    drawn: rows.map(() => 1),
    rest: rows.map(row => row.rest),
    causes: rows.map(row => row.causes),
    noise: rows.map(() => 0),
    draws: rows.map(row => row.draws),
    systems: {
      names,
      idx: rows.flatMap(row => row.systems.map(([name]) => names.indexOf(name))),
      ms: rows.flatMap(row => row.systems.map(([, ms]) => Math.round(ms * 100) / 100))
    },
    nodes: rows.map(row => (row.rest === 1 ? 0 : 3)),
    passes: passRowsOf(rows)
  };
}

/**
 * An `editor.perf.frames { after }` answer: the frames after `after` (from DEMO_FIRST without one)
 * up to `last`, at most 2048.
 *
 * @param after - The newest frame the reader holds; undefined for the first read.
 * @param last - The newest frame the phone drew (`demoFrameAt(now)`).
 * @returns The wire.
 * @example
 * ```ts
 * demoFrames(undefined, 4960).frame.length; // 360
 * ```
 */
export function demoFrames(after: number | undefined, last: number): PerfFramesWire {
  const from = Math.max(after === undefined ? DEMO_FIRST : after + 1, last - MAX_FRAMES + 1);
  return framesWireOf(from, last);
}

/**
 * The boot events of the page: 13 programs compiled while loading, and the two problems the fog
 * raises (filter-still, target-churn).
 *
 * @returns The lines, oldest first.
 */
function bootLines(): PerfTimelineLine[] {
  const labels = [
    "sprite",
    "tilemap",
    "text",
    "nine-slice",
    "particles",
    "mask",
    "colorMatrix",
    "bloom",
    "add",
    "hud",
    "ward",
    "ghost",
    "shard"
  ];
  return [
    ...labels.map(label => line.shader(DEMO_T0, DEMO_FIRST, label, 4, true, null)),
    line.problem(DEMO_T0 + 20, "filter-still", "fogLayer", false, DEMO_FIRST + 45),
    line.problem(DEMO_T0 + 30, "target-churn", "fogLayer", false, DEMO_FIRST + 10)
  ];
}

/**
 * The events of one loop: the adaptive drop and rise, the three GCs and, in the first loop, the fog
 * blur compiled inside a frame.
 *
 * @param loop - The loop number.
 * @returns The lines with their frames, oldest first.
 */
function loopLines(loop: number): { frame: number; line: PerfTimelineLine }[] {
  const base = DEMO_FIRST + loop * DEMO_LOOP;
  const at = (index: number): number => demoTime(base + index);
  const rates = [
    { frame: base + DROP_AT, line: line.rate(at(DROP_AT), base + DROP_AT, 120, 60, "missed") },
    { frame: base + RISE_AT, line: line.rate(at(RISE_AT), base + RISE_AT, 60, 120, "headroom") }
  ];
  const gcs = [...GCS].map(([index, gc]) => ({
    frame: base + index,
    line: line.gc(at(index), base + index, gc.freedMb)
  }));
  const compile =
    loop === 0
      ? [{ frame: base + 289, line: line.shader(at(289), base + 289, "fog.blur", 31) }]
      : [];
  return [...rates, ...gcs, ...compile].toSorted((one, other) => one.frame - other.frame);
}

/**
 * An `editor.perf.events { after }` answer: the lines with a seq after `after` whose frame the phone
 * drew (up to `last`).
 *
 * @param after - The newest seq the reader holds; undefined for the first read.
 * @param last - The newest frame the phone drew.
 * @returns The wire.
 * @example
 * ```ts
 * demoEvents(undefined, 4960).items.length; // 21: 15 at boot, 6 in the first loop
 * ```
 */
export function demoEvents(after: number | undefined, last: number): PerfEventsWire {
  const items: { seq: number; line: PerfTimelineLine }[] = [];
  let seq = 0;
  for (const entry of bootLines()) {
    seq += 1;
    items.push({ seq, line: entry });
  }
  const loops = placeOf(last).loop;
  for (let loop = 0; loop <= loops; loop += 1) {
    for (const entry of loopLines(loop)) {
      if (entry.frame > last) continue;
      seq += 1;
      items.push({ seq, line: entry.line });
    }
  }
  return {
    v: 1,
    epoch: DEMO_EPOCH,
    timeOrigin: DEMO_TIME_ORIGIN,
    next: seq + 1,
    lost: false,
    items: items.filter(item => after === undefined || item.seq > after)
  };
}

/** The demo phone's user agent: Android 15, WebView 140. */
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15; SM-A266B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36";

/** The demo's engine fingerprint. */
const DEMO_ENGINE = "0.15.1+9c41e0";

/** The object counters at a page time: listeners +12/min, render targets +2/min, the rest steady. */
function countsAt(pageMs: number): NonNullable<PerfSecond["counts"]> {
  const minutes = Math.max(0, pageMs - DEMO_T0) / 60_000;
  return {
    entities: 412,
    views: 96,
    timers: 8,
    frameListeners: 210 + Math.round(12 * minutes),
    inputListeners: 4
  };
}

/**
 * An `editor.perf.second` value of the demo phone at its newest frame: the adaptive rate (60 between
 * the drop and the rise), its WebView heap (frozen: never shown), the monitoring state (passes on),
 * the capabilities, the epoch and the object counters.
 *
 * @param last - The newest frame the phone drew.
 * @returns The value.
 * @example
 * ```ts
 * demoSecond(4860).rate.fps; // 60: dropped at f4855
 * ```
 */
export function demoSecond(last: number): PerfSecond {
  const row = demoRow(last);
  const { index } = placeOf(last);
  const resting = row.rest === 1;
  const fps = index >= DROP_AT && index < RISE_AT ? 60 : 120;
  const minutes = Math.max(0, row.t - DEMO_T0) / 60_000;
  return secondOf({
    fps: { loop: fps, drawn: fps },
    spikes: 3,
    budgetMs: row.budgetMs,
    rate: {
      fps,
      mode: "auto",
      reason: fps === 60 ? "missed" : "start",
      displayHz: 120,
      switches: 2
    },
    activity: {
      idle: resting,
      idleSince: null,
      idleFrames: resting ? index - REST_FROM : 0,
      idleMs: 0,
      breaks: 0,
      p90Ms: 7.1
    },
    sample: {
      ...sampleOf({
        t: DEMO_TIME_ORIGIN + row.t,
        frame: last,
        textures: { count: 34, mb: 112, art: 96, targets: 6, kept: 0 },
        views: 96,
        pooled: 0,
        heapMb: 41
      }),
      targets: { created: 6 + Math.round(2 * minutes), destroyed: 6 }
    } as PerfSampleLine,
    display: {
      dpr: 2.625,
      resolution: 1,
      maxResolution: 1,
      canvas: { w: 1080, h: 2340 },
      css: { w: 411, h: 891 },
      safeArea: { t: 32, r: 0, b: 24, l: 0 },
      backend: "webgpu",
      orientation: "portrait",
      hz: 120
    } as PerfSecond["display"],
    device: {
      userAgent: USER_AGENT,
      model: "SM-A266B",
      modelFrom: "ua",
      webview: "140",
      cores: 8,
      memoryGb: 6
    },
    build: "debug-20261016T090000Z",
    engine: DEMO_ENGINE,
    monitor: {
      engine: true,
      sections: { ...SECTION_DEFAULTS, passes: true, shaders: true },
      feeds: { passes: true, systems: true, nodes: true },
      costMs: {
        gpu: 0.3,
        passes: 0.1,
        shaders: 0.05,
        problems: 0.004,
        memory: 0.01,
        systems: 0.2,
        nodes: 0.1,
        longFrames: 0
      },
      monitorMs: 0.21,
      editorMs: 0.12,
      overdraw: false
    },
    memory: {
      heapMb: 41,
      source: "performance.memory",
      trusted: false,
      why: "webview",
      processMb: null
    },
    caps: {
      passOwners: true,
      passDraws: true,
      passFormat: true,
      systemNames: true,
      shaderEvents: true,
      problems: true,
      gc: true,
      sections: true,
      detail: true,
      passesLine: false,
      gpuTimer: true,
      heap: "untrusted"
    },
    epoch: DEMO_EPOCH,
    counts: countsAt(row.t),
    appId: "com.moku.memory.debug"
  });
}

/**
 * An `editor.perf.passes` value: the agent's pass rows of the second ending at `last`, its heaviest
 * frame, the shader counters (14 programs, 2 re-links) and the targets churned.
 *
 * @param last - The newest frame the phone drew.
 * @returns The value.
 * @example
 * ```ts
 * demoPasses(4860).heaviest; // { frame: 4853, row: … }: the GPU-sustained spike
 * ```
 */
export function demoPasses(last: number): PerfPassesWire {
  const end = demoTime(last);
  let first = last;
  while (first > DEMO_FIRST && end - demoTime(first - 1) <= 1000) first -= 1;
  const rows: DemoRow[] = [];
  for (let frame = first; frame <= last; frame += 1) rows.push(demoRow(frame));
  let heaviest = 0;
  for (const [index, row] of rows.entries()) {
    if (row.gpuMs > (rows[heaviest]?.gpuMs ?? 0)) heaviest = index;
  }
  return {
    v: 1,
    source: "agent",
    t: end,
    frames: rows.length,
    tiler: false,
    gpuTimer: true,
    rows: passRowsOf(rows),
    heaviest: { frame: rows[heaviest]?.frame ?? last, row: heaviest },
    line: null,
    shaders: { pipelines: 14, hits: 212, compiles: 2, variants: 0, relinks: 2 },
    targets: { created: 6, destroyed: 6 },
    lost: 0
  };
}

/**
 * An `editor.perf.detail { from, to }` answer: every system of the range (the engine's detail) and
 * the nodes it updated or redrew.
 *
 * @param from - The range's first frame.
 * @param to - Its last.
 * @returns The answer.
 * @example
 * ```ts
 * demoDetail(4810, 4860).nodes?.map(node => node.label); // ["fogLayer", "wardMap", "hudRoot"]
 * ```
 */
export function demoDetail(from: number, to: number): PerfDetailWire {
  const awake = framesWireOf(from, to).rest.filter(rest => rest === 0).length;
  return {
    v: 1,
    from,
    to,
    source: "engine",
    reason: null,
    frames: framesWireOf(from, to),
    nodes: [
      { entity: 31, label: "fogLayer", how: "redraw", count: Math.max(1, Math.round(awake * 0.4)) },
      { entity: 12, label: "wardMap", how: "mark", count: Math.max(1, Math.round(awake * 0.4)) },
      { entity: 3, label: "hudRoot", how: "mark", count: 2 }
    ]
  };
}

/**
 * The demo's recording: started by the agent Claude 42 s ago, 3.1 MB, marks "boss intro" and "fog on".
 *
 * @param overrides - Field overrides.
 * @returns The `editor.recorder` value.
 * @example
 * ```ts
 * demoRecorder().startedBy; // { by: "agent", name: "Claude" }
 * ```
 */
export function demoRecorder(overrides: Partial<RecorderSource> = {}): RecorderSource {
  return {
    ...recorderOf({
      lines: 3120,
      bytes: 3_100_000,
      sent: 3100,
      pending: 20,
      file: "perf-20261016-1412-sm-a266b.jsonl",
      label: "A Memory Missing, A26",
      sinceMs: 42_000,
      startedBy: { by: "agent", name: "Claude" }
    }),
    marks: [
      { atMs: 12_000, label: "boss intro", auto: false },
      { atMs: 31_000, label: "fog on", auto: false }
    ],
    ...overrides
  };
}

/** The heap's GC cycle, ms: it grows 3.3 MB/s and falls to the baseline every 9 s. */
const HEAP_CYCLE_MS = 9000;

/**
 * The phone's JS heap at a page time: a 27–57 MB sawtooth whose baseline after GC grows 1.8 MB/min.
 *
 * @param pageMs - Page-clock ms.
 * @returns MB.
 * @example
 * ```ts
 * demoHeap(10_000); // 27.4
 * ```
 */
export function demoHeap(pageMs: number): number {
  const since = Math.max(0, pageMs - DEMO_T0);
  const cycleStart = since - (since % HEAP_CYCLE_MS);
  const baseline = 27.4 + (1.8 * cycleStart) / 60_000;
  return Math.round((baseline + (3.3 * (since - cycleStart)) / 1000) * 100) / 100;
}

/**
 * A CPU reading of a process: % of all 8 cores and of one core.
 *
 * @param pid - The process.
 * @param name - Its name.
 * @param pct - % of all cores.
 * @returns The reading.
 */
function cpuReading(pid: number, name: string, pct: number) {
  return {
    available: true as const,
    source: `/proc/${pid}/stat`,
    value: { pid, name, pct, oneCorePct: pct * 8 }
  };
}

/**
 * A `dumpsys meminfo` reading of a process (the app holds the Java heap and GL).
 *
 * @param pid - The process.
 * @param total - Its PSS, MB.
 * @param at - Computer epoch ms of the record.
 * @returns The reading.
 */
function memoryReading(pid: number, total: number, at: number) {
  const app = pid === 23_811;
  return {
    available: true as const,
    source: "dumpsys meminfo",
    value: {
      pid,
      totalPssMb: total,
      javaMb: app ? 38 : null,
      nativeMb: app ? 142 : 118,
      graphicsMb: app ? 196 : 172,
      glMb: app ? 88 : null,
      codeMb: 54,
      stackMb: 1.2,
      otherMb: 23,
      systemMb: null,
      at: at - 2000
    }
  };
}

/**
 * A wired telemetry record of the demo phone at a computer time (with the clock offset 0: the page
 * time is `at − DEMO_TIME_ORIGIN`): CPU per process, GPU busy and clock, PSS per process, and the
 * last second's CDP heap samples (4 Hz) with the GC inferred from a drop.
 *
 * @param at - Computer epoch ms of the record.
 * @returns The record.
 * @example
 * ```ts
 * demoTelemetry(DEMO_TIME_ORIGIN + 70_000).gpu; // { available: true, source: "/sys/kernel/gpu", value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 } }
 * ```
 */
export function demoTelemetry(at: number): DeviceTelemetry {
  const page = at - DEMO_TIME_ORIGIN;
  const samples = [750, 500, 250, 0].map(back => ({
    t: at - back,
    usedMb: demoHeap(page - back),
    totalMb: 64
  }));
  const gcs: { t: number; freedMb: number; inferred: boolean }[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const drop = (samples[index - 1]?.usedMb ?? 0) - (samples[index]?.usedMb ?? 0);
    if (drop > 5) gcs.push({ t: samples[index]?.t ?? at, freedMb: drop, inferred: true });
  }
  return {
    v: 1,
    device: DEVICE.id,
    serial: "R5CX30ABCDE",
    at,
    wired: true,
    gpu: {
      available: true,
      source: "/sys/kernel/gpu",
      value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 }
    },
    cpu: {
      cores: 8,
      app: cpuReading(23_811, "com.moku.memory", 27),
      renderer: cpuReading(23_840, "sandboxed_process0", 35),
      surfaceflinger: cpuReading(612, "surfaceflinger", 11)
    },
    memory: { app: memoryReading(23_811, 541, at), renderer: memoryReading(23_840, 424, at) },
    heap: {
      available: true,
      source: "cdp Runtime.getHeapUsage",
      value: { samples, gcs }
    }
  };
}

/** The demo phone's session on the hub (A Memory Missing on the A26). */
export function demoSession(id = DEMO_SESSION): SessionInfo {
  return {
    id,
    game: "A Memory Missing 0.4.2",
    page: "http://127.0.0.1:47600/",
    embedded: false,
    connectedAt: 1000,
    device: DEVICE
  };
}

/** The sources and commands the demo phone's agent lists (spec 10 Delta 2026-10-16b, M4). */
export const DEMO_SOURCES: readonly string[] = [
  "editor.perf.second",
  "editor.perf.frames",
  "editor.perf.events",
  "editor.perf.passes",
  "editor.perf.detail",
  "editor.recorder",
  "game.render",
  "game.assets",
  "game.effects"
];

/** The commands Render sends. */
export const DEMO_COMMANDS: readonly string[] = [
  "game.frameRate",
  "editor.perf.sections",
  "game.debug",
  "editor.record"
];

/**
 * The demo phone's manifest.
 *
 * @returns The manifest.
 */
export function demoManifest(): Manifest {
  return {
    game: "A Memory Missing 0.4.2",
    page: "http://127.0.0.1:47600/",
    embedded: false,
    sources: DEMO_SOURCES.map(id => ({ id, title: id, input: {}, changes: "frame" as const })),
    commands: DEMO_COMMANDS.map(id => ({ id, title: id, input: {}, effect: "cosmetic" as const }))
  };
}

/**
 * connect's device directory with the demo phone plugged in and linked (by wire, device mode on).
 *
 * @param session - Its open session; null while away.
 * @returns The directory.
 */
export function demoDirectory(session: string | null = DEMO_SESSION): DeviceDirectory {
  return {
    v: 1,
    mode: {
      on: true,
      owner: "connect",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    },
    confirmIn: "page",
    adb: { available: true },
    wire: [
      {
        serial: "R5CX30ABCDE",
        state: "device",
        transport: "usb",
        model: "SM-A266B",
        name: "Galaxy A26",
        os: "Android 15",
        phase: "linked",
        device: DEVICE.id
      }
    ],
    asking: [],
    linked: [
      {
        id: DEVICE.id,
        model: "SM-A266B",
        link: "adb",
        address: "127.0.0.1",
        online: session !== null,
        engine: DEMO_ENGINE,
        build: "debug-20261016T090000Z",
        latencyMs: 9,
        session
      }
    ],
    at: DEMO_TIME_ORIGIN
  };
}

/** The demo scene's game.render, game.assets and game.effects values. */
export const DEMO_RENDER: Json = {
  fps: 60,
  frameMs: 8.9,
  textures: 34,
  textureMb: 112,
  views: 412,
  pooled: 0,
  renderPasses: 5,
  drawCalls: 66
};

export const DEMO_ASSETS: Json = {
  textureMb: 112,
  budgetMb: 256,
  bundles: [
    { name: "core", tier: "boot", mb: 41.2, lastUsed: 4960 },
    { name: "ward", tier: "level", mb: 58.6, lastUsed: 4960 },
    { name: "fx", tier: "lazy", mb: 12.2, lastUsed: 4960 }
  ]
};

export const DEMO_EFFECTS: Json = { particles: 18, emitters: 1, filters: 24, renderPasses: 49 };

/** The files of the demo's systems the project index finds (`system:<name>`). */
export const DEMO_FILES: Readonly<Record<string, { path: string; line: number }>> = {
  "ward.update": { path: "src/features/ward/rules.ts", line: 142 },
  "fog.render": { path: "src/features/fog/nodes.ts", line: 58 },
  "ui.solve": { path: "src/features/hud/nodes.ts", line: 31 }
};
