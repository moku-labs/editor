/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines the fixtures build */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { Require } from "../../../config";
import { filesPlugin } from "../../files";
import { hubPlugin } from "../../hub";
import type {
  DeviceLines,
  EditorRoutes,
  HubApi,
  HubDeviceEvent,
  LinkedDevice
} from "../../hub/types";
import type {
  FrameRecord,
  PerfCause,
  PerfCollectorLine,
  PerfEventLine,
  PerfEventName,
  PerfHeaderLine,
  PerfLogLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfThermalLine
} from "../../perf/protocol";
import type { Json } from "../../registry/protocol";
import { createCollectorState } from "../state";
import type { CollectorConfig, CollectorCtx, CollectorEvents } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes and fixtures of the collector tests: typed log lines, a mock
// ctx (log, emit, files and hub fakes), device events and temp folders.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (same values as index.ts). */
export const DEFAULT_CONFIG: CollectorConfig = {
  out: ".moku/perf",
  everyS: 10,
  reverseEveryMs: 2000,
  adb: "adb",
  adbTimeoutMs: 5000,
  appId: undefined
};

/** The hub token of the fake hub. */
export const TOKEN = "t".repeat(43);

/** The log name of the fixtures' device log. */
export const LOG = "perf-20261014-1532-sm-a266b.jsonl";

/** A build id the fixtures carry. */
const BUILD = "debug-1";

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/** The fake hub: route registration, guard, token and path. */
export type FakeHub = Pick<HubApi, "path"> & {
  readonly addRoutes: Mock<(routes: EditorRoutes) => void>;
  readonly guard: Mock<HubApi["guard"]>;
  readonly token: Mock<() => string>;
  /** Every route registered through addRoutes. */
  readonly routes: Map<string, EditorRoutes[string]>;
};

/**
 * A fake hub whose token is TOKEN and whose guard lets every request through.
 *
 * @returns The fake hub.
 */
export function fakeHub(): FakeHub {
  const routes = new Map<string, EditorRoutes[string]>();
  return {
    routes,
    path: () => "/__editor",
    addRoutes: vi.fn((added: EditorRoutes) => {
      for (const [key, route] of Object.entries(added)) routes.set(key, route);
    }),
    guard: vi.fn<HubApi["guard"]>(() => undefined),
    token: vi.fn(() => TOKEN)
  };
}

/** The emit of the collector as one signature a mock can take. */
export type EmitMock = Mock<
  (name: keyof CollectorEvents, payload: CollectorEvents[keyof CollectorEvents]) => void
>;

/** A collector ctx whose emit, log, files and hub are fakes. */
export type TestCtx = CollectorCtx & {
  readonly emit: EmitMock;
  readonly log: ReturnType<typeof createLog>;
  readonly hub: FakeHub;
};

/**
 * A collector ctx with fresh state; `files.root()` answers `root`.
 *
 * @param root - The files root (a temp folder).
 * @param overrides - Config fields to change.
 * @returns The ctx.
 */
export function createCtx(root: string, overrides: Partial<CollectorConfig> = {}): TestCtx {
  const hub = fakeHub();
  const files = { root: () => root };
  const require = ((plugin: unknown) => {
    if (plugin === filesPlugin) return files;
    if (plugin === hubPlugin) return hub;
    throw new Error("unknown plugin");
  }) as unknown as Require;

  return {
    config: { ...DEFAULT_CONFIG, ...overrides },
    state: createCollectorState(),
    emit: vi.fn(),
    log: createLog(),
    require,
    hub
  };
}

/**
 * A fresh temp folder.
 *
 * @returns Its absolute path.
 */
export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "moku-collector-"));
}

/**
 * Removes a temp folder.
 *
 * @param dir - The folder.
 * @returns When it is gone.
 */
export function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

/**
 * The JSON lines of a file.
 *
 * @param file - The file.
 * @returns Every line, parsed.
 */
export async function fileLines(file: string): Promise<Record<string, Json>[]> {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line));
}

/**
 * A paired device as the hub reports it.
 *
 * @param overrides - Fields to change.
 * @returns The device.
 */
export function deviceOf(overrides: Partial<LinkedDevice> = {}): LinkedDevice {
  return {
    id: "d-7f3a",
    model: "SM-A266B",
    link: "adb",
    address: "127.0.0.1",
    port: 47_600,
    engine: "0.14.12+9c41e0",
    build: "debug-pair",
    pairedAt: 1_791_986_083_963,
    online: true,
    ...overrides
  };
}

/**
 * A `hub:device` lines event.
 *
 * @param device - The device.
 * @param items - The batch's lines.
 * @param batch - The rest of the batch: log, rx, gap, rejected, from.
 * @returns The event.
 */
export function linesEvent(
  device: LinkedDevice,
  items: readonly PerfLogLine[],
  batch: Partial<DeviceLines> = {}
): HubDeviceEvent {
  return {
    kind: "lines",
    device,
    lines: { log: LOG, from: 0, rx: 1_791_986_090_000, gap: 0, rejected: 0, items, ...batch }
  };
}

/**
 * An 81-slot frame histogram.
 *
 * @param counts - Count by bucket index.
 * @returns The histogram.
 */
export function histOf(counts: Readonly<Record<number, number>>): number[] {
  return Array.from({ length: 81 }, (_, index) => counts[index] ?? 0);
}

/** A mean/max pair of the fixtures. */
const MEAN_MAX = { mean: 0.5, max: 1 };

/**
 * A header line without `rate` (a block-2b engine), maxFps 120.
 *
 * @param t - Page t.
 * @returns The header.
 */
function baseHeader(t: number): PerfHeaderLine {
  return {
    v: 1,
    kind: "header",
    t,
    build: BUILD,
    timeOrigin: 1_791_986_000_000,
    engine: "0.14.12+9c41e0",
    device: {
      userAgent: "Mozilla/5.0",
      model: "SM-A266B",
      modelFrom: "shell",
      webview: null,
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
    display: {
      dpr: 2,
      resolution: 1,
      maxResolution: 2,
      canvas: { w: 1080, h: 2340 },
      css: { w: 540, h: 1170 },
      safeArea: { t: 0, r: 0, b: 0, l: 0 },
      backend: "webgpu",
      orientation: "portrait"
    },
    thermal: null,
    config: { maxFps: 120, idleFps: 10, budgetMs: 8.33, budget: "rate", frames: 1024 },
    measured: ["gpu", "passes"]
  };
}

/**
 * A header line (rate 120, maxFps 120).
 *
 * @param t - Page t.
 * @param overrides - Fields to change.
 * @returns The header.
 */
export function headerLine(t = 0, overrides: Partial<PerfHeaderLine> = {}): PerfHeaderLine {
  const rate = {
    fps: 120,
    mode: "auto",
    reason: "start",
    displayHz: 120,
    ladder: [120, 60],
    thermal: null
  } as const;
  return { ...baseHeader(t), rate, ...overrides };
}

/**
 * A header without the `rate` key (a block-2b engine).
 *
 * @param maxFps - The configured maxFps.
 * @returns The header.
 */
export function headerWithoutRate(maxFps: number): PerfHeaderLine {
  const header = baseHeader(0);
  return { ...header, config: { ...header.config, maxFps } };
}

/**
 * A sample line: one second of `garden/boss`, 118 of 120 frames drawn at about 8 ms.
 *
 * @param t - Page t.
 * @param overrides - Fields to change.
 * @returns The sample.
 */
export function sampleLine(t: number, overrides: Partial<PerfSampleLine> = {}): PerfSampleLine {
  return {
    v: 1,
    kind: "sample",
    t,
    build: BUILD,
    frame: 100,
    windowMs: 1000,
    path: "garden/boss",
    ticks: 120,
    frames: 120,
    drawn: 118,
    idle: 0,
    gaps: { missed: 0, drawn: 118, idle: 0 },
    gapMs: { p50: 8.3, p90: 9.1, p99: 12 },
    frameHist: histOf({ 8: 118 }),
    workMs: { p50: 3, p90: 4, max: 6 },
    overBudget: 0,
    phasesMs: {
      start: MEAN_MAX,
      input: MEAN_MAX,
      animate: MEAN_MAX,
      layout: MEAN_MAX,
      sync: MEAN_MAX,
      signals: MEAN_MAX,
      render: MEAN_MAX,
      agent: MEAN_MAX
    },
    systems: null,
    gpuMs: { p50: 4.8, p90: 5.2, max: 6, frames: 118 },
    passes: { mean: 6, max: 7, stencil: null },
    draws: null,
    filters: null,
    uploads: null,
    compiles: null,
    marks: null,
    rebuilds: null,
    longFrames: null,
    heapMb: 151,
    textures: { count: 12, mb: 134, art: 96, targets: 32, kept: 6 },
    views: 1,
    pooled: 0,
    resolution: 1,
    monitorMs: 0.1,
    spikes: 0,
    kept: null,
    ...overrides
  };
}

/**
 * The frame record of a spike.
 *
 * @param t - Page t.
 * @param causes - The causes.
 * @param path - The flow path.
 * @param rateMs - One frame of the rate.
 * @returns The record.
 */
function frameRecord(
  t: number,
  causes: readonly PerfCause[],
  path: string,
  rateMs: number
): FrameRecord {
  return {
    frame: 4812,
    t,
    gapMs: 41.3,
    capMs: 0,
    rateMs,
    budgetMs: rateMs,
    skipped: 0,
    startMs: 0.2,
    phases: { input: 0, animate: 1, layout: 1, sync: 0, signals: 0, render: 2, agent: 0 },
    workMs: 8,
    drawn: true,
    idle: false,
    stepped: true,
    reason: null,
    passes: 6,
    stencilPasses: null,
    draws: null,
    filters: null,
    uploads: null,
    compiles: null,
    marks: null,
    rebuilds: null,
    systems: null,
    gpuMs: 6.6,
    gpuPartial: false,
    path,
    changed: [],
    causes,
    kept: null
  };
}

/**
 * A spike line.
 *
 * @param t - Page t.
 * @param causes - The frame's causes.
 * @param where - Its flow path and one frame of its rate.
 * @param where.path - The flow path.
 * @param where.rateMs - One frame of the rate, ms.
 * @returns The spike.
 */
export function spikeLine(
  t: number,
  causes: readonly PerfCause[],
  where: { path?: string; rateMs?: number } = {}
): PerfSpikeLine {
  return {
    v: 1,
    kind: "spike",
    t,
    build: BUILD,
    frame: frameRecord(t, causes, where.path ?? "garden/boss", where.rateMs ?? 8.33),
    systems: null,
    compiles: [],
    filters: [],
    passes: [],
    longFrames: []
  };
}

/**
 * An event line.
 *
 * @param t - Page t.
 * @param name - The event name.
 * @param detail - Its detail.
 * @returns The event.
 */
export function eventLine(
  t: number,
  name: PerfEventName,
  detail: Readonly<Record<string, Json>>
): PerfEventLine {
  return { v: 1, kind: "event", t, build: BUILD, frame: null, name, detail };
}

/**
 * A `rate` event line.
 *
 * @param t - Page t.
 * @param from - The old rate.
 * @param to - The new rate.
 * @param reason - Why.
 * @returns The event.
 */
export function rateLine(t: number, from: number, to: number, reason = "missed"): PerfEventLine {
  return eventLine(t, "rate", {
    from,
    to,
    reason,
    mode: "auto",
    displayHz: 120,
    thermal: "none",
    window: { drawn: 41, missed: 9, heavy: 0 },
    dwellMs: 5000
  });
}

/**
 * A mark line.
 *
 * @param t - Page t.
 * @param label - The label.
 * @param auto - A flow rest mark.
 * @returns The mark.
 */
export function markLine(t: number, label: string, auto = false): PerfMarkLine {
  return { v: 1, kind: "mark", t, build: BUILD, label, auto };
}

/**
 * A thermal line of the shell (device null).
 *
 * @param t - Page t.
 * @param overrides - Fields to change.
 * @returns The thermal line.
 */
export function thermalLine(t: number, overrides: Partial<PerfThermalLine> = {}): PerfThermalLine {
  return {
    v: 1,
    kind: "thermal",
    t,
    build: BUILD,
    status: 0,
    headroom: null,
    at: t,
    android: null,
    source: "shell",
    device: null,
    batteryC: 31.2,
    sensors: { SKIN: 33.1 },
    ...overrides
  };
}

/**
 * A gfx line of the collector: 10 s, 600 frames.
 *
 * @param t - Page t.
 * @param overrides - Fields to change.
 * @returns The gfx line.
 */
export function gfxLine(t: number, overrides: Partial<PerfCollectorLine> = {}): PerfCollectorLine {
  return {
    v: 1,
    kind: "gfx",
    t,
    build: BUILD,
    device: "SM-A266B",
    seconds: 10,
    frames: 600,
    janky: 6,
    fps: 60,
    p50: 16,
    p90: 19,
    p99: 25,
    hist: { "16": 500, "19": 90, "25": 10 },
    ...overrides
  };
}

/**
 * A JSONL text of lines.
 *
 * @param lines - The lines (objects or raw text).
 * @returns The text, one line each, ending in a newline.
 */
export function jsonl(lines: readonly (object | string)[]): string {
  return `${lines.map(line => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`;
}

/**
 * Whether a text holds a C0 or C1 control, DEL, or a bidi embedding, override or isolate.
 *
 * @param text - The text.
 * @returns Whether one is there.
 */
export function hasUnsafeChar(text: string): boolean {
  return [...text].some(char => {
    const code = char.codePointAt(0) ?? 0;
    return (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x20_2a && code <= 0x20_2e) ||
      (code >= 0x20_66 && code <= 0x20_69)
    );
  });
}
