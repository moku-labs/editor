/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import type { SessionDevice } from "../../hub/protocol";
import type { PerfCause, PerfSampleLine, PerfSpikeLine } from "../../perf/protocol";
import { CAUSE_BITS } from "../../perf/protocol";
import type { Json, SessionInfo } from "../../registry/protocol";
import { toWireValue } from "../../registry/protocol";
import type {
  PerfSecond,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfWindowWire,
  RecorderStatus
} from "../device/contract";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures of the D1 device strip in the owners' shapes (01 SessionDevice, 03
// PerfSecond / PerfWindowWire / PerfSpikeSummary / PerfSpikeRecord, 05
// RecorderStatus): the design's demo phone, six spikes in the 6 s window.
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

/** The computer's engine fingerprint. */
export const COMPUTER_ENGINE = "0.14.13+1ab7f2";

/**
 * The spike frames of the demo window, oldest first, with their causes (primary first). Each has
 * work over budget (js, gpu or a long frame): perf flags a frame for its work, never for a gap or
 * the GC hint alone (spec 03 delta 2026-10-15).
 */
export const SPIKE_FRAMES: readonly { frame: number; causes: readonly PerfCause[] }[] = [
  { frame: 4572, causes: ["js"] },
  { frame: 4630, causes: ["gpu"] },
  { frame: 4701, causes: ["compile", "js", "gap"] },
  { frame: 4760, causes: ["js", "gc?"] },
  { frame: 4812, causes: ["upload", "js", "gap"] },
  { frame: 4845, causes: ["longFrame"] }
];

/** The first and the last frame of the demo window (360 frames at 60 fps). */
export const FIRST_FRAME = 4486;
export const LAST_FRAME = 4845;

/**
 * A session of the hub.
 *
 * @param id - Session id.
 * @param device - The phone; none for a browser session.
 * @returns The session.
 */
export function deviceSession(id: string, device?: SessionDevice): SessionInfo {
  const session = {
    id,
    game: "garden 0.3.0",
    page: "http://127.0.0.1:3000/",
    embedded: false,
    connectedAt: 1000
  };
  return device === undefined ? session : { ...session, device };
}

/**
 * A sample line of the engine (11-monitor) with the strip's numbers.
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
    frame: LAST_FRAME,
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
 * An `editor.perf.second` value of the demo phone.
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
 * The cause bits of a list of causes (CAUSE_BITS).
 *
 * @param causes - The causes.
 * @returns The bits.
 */
export function bitsOf(causes: readonly PerfCause[]): number {
  return causes.reduce((bits, cause) => bits | (1 << CAUSE_BITS.indexOf(cause)), 0);
}

/**
 * An `editor.perf.window` value: 360 frames at 60 fps from FIRST_FRAME, the spikes of
 * SPIKE_FRAMES (or the given ones) at 41 ms.
 *
 * @param spikes - The spike frames and their causes.
 * @param options - Frame count and the GPU timer.
 * @param options.count - Frames; 360 by default.
 * @param options.gpuTimer - Whether the page has a GPU timer.
 * @param options.first - The first frame number.
 * @returns The wire value.
 */
export function windowWire(
  spikes: readonly { frame: number; causes: readonly PerfCause[] }[] = SPIKE_FRAMES,
  options: { count?: number; gpuTimer?: boolean; first?: number } = {}
): PerfWindowWire {
  const count = options.count ?? 360;
  const first = options.first ?? FIRST_FRAME;
  const gpuTimer = options.gpuTimer ?? true;
  const frames = Array.from({ length: count }, (_, index) => first + index);
  const spikeOf = new Map(spikes.map(spike => [spike.frame, spike.causes]));
  return {
    v: 1,
    startMs: 40_000,
    endMs: 46_000,
    gpuTimer,
    frame: frames,
    t: frames.map((_, index) => index * 16.67),
    ms: frames.map(frame => (spikeOf.has(frame) ? 41.3 : 16.7)),
    jsMs: frames.map(() => 4),
    gpuMs: frames.map(() => (gpuTimer ? 6 : null)),
    rateMs: frames.map(() => 16.67),
    budgetMs: frames.map(() => 16.67),
    drawn: frames.map(() => 1),
    causes: frames.map(frame => bitsOf(spikeOf.get(frame) ?? []))
  };
}

/**
 * The wire value as Json.
 *
 * @param wire - The window.
 * @returns The Json value.
 */
export function wireJson(wire: PerfWindowWire): Json {
  return toWireValue(wire);
}

/**
 * The `editor.perf.spikes` value of the demo window.
 *
 * @returns The summaries, oldest first.
 */
export function spikesOf(): PerfSpikeSummary[] {
  return SPIKE_FRAMES.map(({ frame, causes }) => summaryOf(frame, causes));
}

/**
 * One spike summary.
 *
 * @param frame - The frame.
 * @param causes - Its causes, primary first.
 * @returns The summary.
 */
export function summaryOf(frame: number, causes: readonly PerfCause[]): PerfSpikeSummary {
  return {
    frame,
    agoMs: (LAST_FRAME - frame) * 16.67,
    ms: 41.3,
    budgetMs: 16.7,
    overMs: 24.6,
    cause: causes[0] ?? "gap",
    causes,
    jsMs: 8,
    gpuMs: 6.6,
    path: "garden/boss",
    why: "41.0 MB of textures uploaded this frame (bundle garden-boss)"
  };
}

/**
 * The engine's spike line of a frame.
 *
 * @param overrides - Field overrides.
 * @returns The line.
 */
export function spikeLineOf(overrides: Partial<PerfSpikeLine> = {}): PerfSpikeLine {
  return {
    v: 1,
    kind: "spike",
    t: 45_020,
    build: DEVICE.build,
    frame: {
      frame: 4812,
      t: 45_000,
      gapMs: 41.3,
      capMs: 16.67,
      rateMs: 16.67,
      budgetMs: 16.7,
      skipped: 0,
      startMs: 45_000,
      phases: {
        input: 0.2,
        animate: 1.1,
        layout: 0.4,
        sync: 2.2,
        signals: 0.3,
        render: 3.1,
        agent: 0.1
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
      kept: null
    },
    systems: [
      { name: "ripple", ms: 1.2 },
      { name: "frost-apply", ms: 2.4 }
    ],
    compiles: [],
    filters: [{ kind: "blur", applies: 3, mpx: 1.5 }],
    passes: [
      { index: 0, kind: "canvas", label: null, stencil: null, w: 1080, h: 2340, gpuMs: 2 },
      { index: 1, kind: "filter", label: "glass", stencil: null, w: 540, h: 1170, gpuMs: 4.6 }
    ],
    longFrames: [],
    ...overrides
  };
}

/**
 * An `editor.perf.spike` answer: frame 4812, an upload over a 60 fps budget.
 *
 * @param overrides - Field overrides.
 * @returns The record.
 */
export function recordOf(overrides: Partial<PerfSpikeRecord> = {}): PerfSpikeRecord {
  return {
    ...summaryOf(4812, ["upload", "gap"]),
    agoMs: 980,
    at: 1_760_454_045_000,
    fps: 60,
    rateSwitch: null,
    gapMs: 41.3,
    drawn: true,
    gpuPartial: false,
    phases: null,
    passes: 2,
    draws: 212,
    filters: null,
    uploads: { count: 3, mb: 41 },
    compiles: 0,
    changed: ["bundle"],
    events: [],
    detail: spikeLineOf(),
    ...overrides
  };
}

/**
 * An `editor.recorder` value.
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
    ...overrides
  };
}
