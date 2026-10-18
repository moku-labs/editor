/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { vi } from "vitest";
import { DISPLAY, headerLine, sampleLine } from "../../../../tests/fixtures/fake-monitor";
import type { Require } from "../../../config";
import { createGraphState } from "../../perf/graph";
import type {
  MonitorLike,
  PerfSampleLine,
  PerfSecond,
  PerfSpikeRecord,
  PerfStatus,
  PerfWindowView
} from "../../perf/protocol";
import type { LogFileInfo, LogMark, RecorderStatus, ShareResult } from "../../recorder/types";
import type {
  BuildInfo,
  CommandDescriptor,
  CommandVia,
  Json,
  Manifest,
  RunResult,
  RunState
} from "../../registry/protocol";
import type { CommandEntry } from "../../registry/types";
import { startOverlayWith, stopOverlay } from "../lifecycle";
import { createVisitors } from "../paint/graph";
import { createOverlayState } from "../state";
import type { Config, GraphContext2DLike, GraphSeam, OverlayCtx, OverlayPluginCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the overlay unit tests: a log, a registry slice, a channel
// that records its runs, a perf that hands out a window built from rows (and
// poisons it after each visit), a recorder, a monitor that records the agent
// bracket, and a spy painter (happy-dom has no 2D context).
// ─────────────────────────────────────────────────────────────────────────────

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

/** The envelope every fake registry answers. */
export const ENVELOPE: RunState = { path: "garden/boss", frame: 4812, tainted: false };

/**
 * A command descriptor.
 *
 * @param id - The id.
 * @param extra - Effect, overlay marker, allowed and reason.
 * @returns The descriptor.
 */
export function command(
  id: string,
  extra: Partial<Omit<CommandDescriptor, "id">> = {}
): CommandDescriptor {
  return { id, title: `Title of ${id}`, input: {}, effect: "cheat", ...extra };
}

/** The three overlay commands of the design's Game tab, on a `--debug` (read-only) build. */
export const GARDEN_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: "garden.glow",
    title: "Glow",
    input: { on: "boolean" },
    effect: "cosmetic",
    overlay: "toggle",
    allowed: true
  },
  {
    id: "garden.fog",
    title: "Fog",
    input: { on: "boolean" },
    effect: "cosmetic",
    overlay: "toggle",
    allowed: true
  },
  {
    id: "story.skipDialogue",
    title: "Skip dialogue",
    input: {},
    effect: "route",
    overlay: "button",
    allowed: false,
    reason: "read-only"
  },
  { id: "garden.reset", title: "Reset", input: {}, effect: "cheat", allowed: true }
];

/** The fake registry: records added entries, answers a settable manifest, build and values. */
export type FakeRegistry = Omit<OverlayCtx["registry"], "game"> & {
  game: OverlayCtx["registry"]["game"];
  /** What `game()` answers (an object with `anim.reducedMotion()` for the slide tests). */
  gameApp: unknown;
  readonly added: CommandEntry[];
  commands: readonly CommandDescriptor[];
  gameName: string;
  buildInfo: BuildInfo;
  readonly values: Map<string, boolean | undefined>;
};

/**
 * Builds a fake registry slice.
 *
 * @param commands - The manifest commands.
 * @returns The fake.
 */
export function fakeRegistry(commands: readonly CommandDescriptor[] = []): FakeRegistry {
  const registry: FakeRegistry = {
    gameApp: {},
    game: () => registry.gameApp as ReturnType<OverlayCtx["registry"]["game"]>,
    added: [],
    commands,
    gameName: "A Memory Missing",
    buildInfo: { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" },
    values: new Map(),
    manifest: (): Manifest => ({
      game: registry.gameName,
      page: "http://127.0.0.1/",
      embedded: false,
      sources: [],
      commands: registry.commands
    }),
    add: entry => {
      if ("run" in entry) registry.added.push(entry);
    },
    envelope: () => ENVELOPE,
    build: () => registry.buildInfo,

    command: id => (registry.values.has(id) ? { value: () => registry.values.get(id) } : {})
  };
  return registry;
}

/** One recorded channel run. */
export type ChannelRun = {
  readonly id: string;
  readonly input: Json | undefined;
  readonly via: CommandVia | undefined;
};

/** The fake channel: records runs, answers with a settable function. */
export type FakeChannel = OverlayCtx["channel"] & {
  readonly runs: ChannelRun[];
  answer: (id: string) => Promise<RunResult>;
};

/**
 * Builds a fake channel.
 *
 * @returns The fake.
 */
export function fakeChannel(): FakeChannel {
  const channel: FakeChannel = {
    runs: [],
    answer: async () => ({ value: true, state: ENVELOPE }),
    run: (id, input, via) => {
      channel.runs.push({ id, input, via });
      return channel.answer(id);
    }
  };
  return channel;
}

/** A monitor that records the agent bracket (and what happened inside it). */
export type BracketMonitor = MonitorLike & { readonly calls: string[] };

/**
 * The unsubscribe of the bracket monitor's stream: nothing to undo.
 */
function unsubscribe(): void {}

/**
 * A monitor whose begin/end calls are recorded in order.
 *
 * @returns The fake monitor.
 */
export function bracketMonitor(): BracketMonitor {
  const calls: string[] = [];
  return {
    calls,
    stream: () => unsubscribe,
    frames: () => {
      throw new Error("not read by the overlay");
    },
    mark: () => undefined,
    event: name => {
      calls.push(`event:${name}`);
    },
    beginAgent: () => {
      calls.push("begin");
    },
    endAgent: () => {
      calls.push("end");
    },
    setResolution: () => 1,
    counts: { register: () => unsubscribe }
  };
}

/** One row of a fake window. */
export type Row = {
  readonly frame: number;
  readonly t?: number;
  readonly ms?: number;
  readonly jsMs?: number;
  readonly gpuMs?: number;
  readonly rateMs?: number;
  readonly budgetMs?: number;
  readonly drawn?: 0 | 1;
  readonly cause?: number;
};

/** A mutable window, as the fake perf builds it. */
type MutableWindow = { -readonly [Key in keyof PerfWindowView]: PerfWindowView[Key] };

/**
 * A window of rows (frame numbers ascending); spikes are the rows with a cause.
 *
 * @param rows - The rows, oldest first.
 * @param version - The window version.
 * @returns The window.
 */
export function windowOf(rows: readonly Row[], version = 1): MutableWindow {
  const spikes = rows.flatMap((row, index) => ((row.cause ?? 0) > 0 ? [index] : []));
  return {
    capacity: Math.max(rows.length, 64),
    count: rows.length,
    startMs: 0,
    endMs: 6000,
    gpuTimer: true,
    version,
    frame: rows.map(row => row.frame),
    t: rows.map((row, index) => row.t ?? index * 16.67),
    ms: rows.map(row => row.ms ?? 16.7),
    jsMs: rows.map(row => row.jsMs ?? 4),
    gpuMs: rows.map(row => row.gpuMs ?? Number.NaN),
    rateMs: rows.map(row => row.rateMs ?? 16.67),
    budgetMs: rows.map(row => row.budgetMs ?? 16.67),
    drawn: rows.map(row => row.drawn ?? 1),
    causes: rows.map(row => row.cause ?? 0),
    cause: rows.map(row => row.cause ?? 0),
    spikes,
    spikeCount: spikes.length
  };
}

/**
 * Ten frames 4803…4812 with spikes on 4805, 4809 and 4812 (GPU times 6 ms on drawn rows).
 *
 * @param version - The window version.
 * @returns The window.
 */
export function tenFrames(version = 1): MutableWindow {
  return windowOf(
    Array.from({ length: 10 }, (_, index) => {
      const frame = 4803 + index;
      const cause = frame === 4805 || frame === 4809 || frame === 4812 ? 2 : 0;
      return { frame, gpuMs: 6, cause };
    }),
    version
  );
}

/**
 * A PerfSecond with a sample (the fixture's), the fixture's display and device.
 *
 * @param overrides - Fields to replace.
 * @param sample - Sample fields to replace; `null` for no sample.
 * @returns The second.
 */
export function secondOf(
  overrides: Partial<PerfSecond> = {},
  sample: Partial<PerfSampleLine> | null = {}
): PerfSecond {
  return {
    state: "on",
    fps: { loop: 60, drawn: 54 },
    spikes: 6,
    budgetMs: 16.67,
    rate: { fps: 60, mode: "fixed", reason: "start", displayHz: 60, switches: 0 },
    render: { passesMax: 3, kept: { pictures: 4, mb: 1.6, retakes: 0 }, redraws: 0, rebuilds: 0 },
    sample: sample === null ? null : sampleLine(4812, sample),
    display: DISPLAY,
    device: headerLine().device,
    gpu: headerLine().gpu,
    build: "debug-20261014T160000Z",
    engine: "0.14.12+9c41e0",
    ...overrides
  };
}

/** The fake perf: a settable status, second, window and records; records every visitor. */
export type FakePerf = OverlayCtx["perf"] & {
  statusValue: PerfStatus;
  secondValue: PerfSecond;
  window: MutableWindow;
  readonly records: Map<number, PerfSpikeRecord>;
  readonly visitors: ((window: PerfWindowView) => void)[];
  monitorValue: MonitorLike | undefined;
  /** Windows handed out, poisoned after the visit returned. */
  readonly handed: MutableWindow[];
};

/**
 * Builds a fake perf. Each `readWindow` hands a fresh copy of `window` and poisons it after the
 * visitor returned, so a kept reference reads count −1 and empty columns.
 *
 * @returns The fake.
 */
export function fakePerf(): FakePerf {
  const perf: FakePerf = {
    statusValue: { state: "on", lost: 0, gpuTimer: true },
    secondValue: secondOf(),
    window: tenFrames(),
    records: new Map(),
    visitors: [],
    monitorValue: undefined,
    handed: [],
    status: () => perf.statusValue,
    second: () => perf.secondValue,
    spike: frame => perf.records.get(frame),
    monitor: () => perf.monitorValue,
    readWindow: visit => {
      perf.visitors.push(visit);
      const handed = { ...perf.window };
      perf.handed.push(handed);
      visit(handed);
      handed.count = -1;
      handed.frame = [];
      handed.spikes = [];
      handed.spikeCount = -1;
    }
  };
  return perf;
}

/** What the overlay passed to `recorder.start`. */
export type StartOptions = Parameters<OverlayCtx["recorder"]["start"]>[0];

/** The fake recorder: a settable status, marks and files; spies for the actions. */
export type FakeRecorder = OverlayCtx["recorder"] & {
  statusValue: RecorderStatus;
  marksValue: LogMark[];
  filesValue: LogFileInfo[];
  readonly calls: string[];
  /** The options of every `start`, in order. */
  readonly starts: StartOptions[];
  shareAnswer: ShareResult;
  failStart: Error | undefined;
};

/** The idle status of the fake recorder. */
export const IDLE: RecorderStatus = {
  state: "idle",
  lines: 0,
  bytes: 0,
  sent: 0,
  pending: 0,
  monitor: true,
  file: null,
  label: null,
  sinceMs: 0,
  storage: "memory",
  dropped: 0,
  startedBy: null
};

/** A recording status: 03:12 in, 1 840 lines, 412 KB, 1 790 sent, 50 pending. */
export const RECORDING: RecorderStatus = {
  ...IDLE,
  state: "recording",
  lines: 1840,
  bytes: 412_000,
  sent: 1790,
  pending: 50,
  file: "perf-20261014-1532-sm-a266b.jsonl",
  sinceMs: 192_000
};

/**
 * A log file entry.
 *
 * @param name - The file name.
 * @param extra - Fields to replace.
 * @returns The entry.
 */
export function logFile(name: string, extra: Partial<LogFileInfo> = {}): LogFileInfo {
  return {
    name,
    label: null,
    startedAt: new Date(2026, 9, 14, 15, 32).getTime(),
    lines: 1840,
    bytes: 412_000,
    sent: 1790,
    current: false,
    storage: "memory",
    ...extra
  };
}

/**
 * Builds a fake recorder.
 *
 * @returns The fake.
 */
export function fakeRecorder(): FakeRecorder {
  const recorder: FakeRecorder = {
    statusValue: IDLE,
    marksValue: [],
    filesValue: [],
    calls: [],
    starts: [],
    shareAnswer: "shared",
    failStart: undefined,
    status: () => recorder.statusValue,
    marks: () => recorder.marksValue,
    files: () => recorder.filesValue,
    start: options => {
      recorder.calls.push("start");
      recorder.starts.push(options);
      if (recorder.failStart) throw recorder.failStart;
      recorder.statusValue = RECORDING;
      return logFile("perf-20261014-1532-sm-a266b.jsonl", { current: true });
    },
    stop: async () => {
      recorder.calls.push("stop");
      recorder.statusValue = IDLE;
      return logFile("perf-20261014-1532-sm-a266b.jsonl");
    },
    mark: label => {
      recorder.calls.push(`mark:${label}`);
      return recorder.statusValue.state === "recording";
    },
    command: (id, _input, label) => {
      recorder.calls.push(`command:${id}:${label}`);
      return recorder.statusValue.state === "recording";
    },
    share: async name => {
      recorder.calls.push(`share:${name}`);
      return recorder.shareAnswer;
    },
    remove: async name => {
      recorder.calls.push(`remove:${name}`);
    }
  };
  return recorder;
}

/** One paint the spy recorded. */
export type SpyPaint = {
  readonly selected: number;
  readonly width: number;
  readonly version: number;
  readonly lead: number;
  readonly layer: string;
};

/** The spy painter: records paints; hit tests answer settable rows. */
export type SpyGraph = GraphSeam & {
  /** The plot canvas's paints. */
  readonly paints: SpyPaint[];
  /** The fixed canvas's paints. */
  readonly fixedPaints: SpyPaint[];
  /** Every `clearRect` of a fake context: x, y, width, height. */
  readonly clears: number[][];
  hitSpike: number;
  hitRow: number;
  /** What `msToPx` answers: the slide distance of one tick (0: no slide). */
  lead: number;
  /** The x of every hit test, CSS px of the canvas. */
  readonly hits: number[];
  noContext: boolean;
  readonly transforms: number[];
};

/**
 * A painter seam made of spies, with a fake 2D context.
 *
 * @returns The spy seam.
 */
export function spyGraph(): SpyGraph {
  const graph: SpyGraph = {
    paints: [],
    fixedPaints: [],
    clears: [],
    hitSpike: -1,
    hitRow: -1,
    lead: 0,
    hits: [],
    noContext: false,
    transforms: [],
    context: () => (graph.noContext ? undefined : fakeContext(graph.transforms, graph.clears)),
    paint: (_g, window, view) => {
      const layer = view.layer ?? "all";
      const paints = layer === "fixed" ? graph.fixedPaints : graph.paints;
      paints.push({
        selected: view.selected,
        width: view.width,
        version: window.version,
        lead: view.leadPx ?? 0,
        layer
      });
    },
    msToPx: () => graph.lead,
    spikeAt: (_state, _window, x) => {
      graph.hits.push(x);
      return graph.hitSpike;
    },
    rowAt: (_state, _window, x) => {
      graph.hits.push(x);
      return graph.hitRow;
    },
    createState: capacity => createGraphState(capacity),
    resetText: vi.fn()
  };
  return graph;
}

/**
 * A 2D context that does nothing but record `setTransform` scales and `clearRect` boxes.
 *
 * @param transforms - Where the scales go.
 * @param clears - Where the cleared boxes go.
 * @returns The context.
 */
export function fakeContext(
  transforms: number[] = [],
  clears: number[][] = []
): GraphContext2DLike {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
    fillText: () => undefined,
    measureText: text => ({ width: text.length * 6 }),
    clearRect: (...box) => {
      clears.push(box);
    },
    setTransform: scale => {
      transforms.push(scale);
    }
  };
}

/** The test domain context. */
export type TestOctx = OverlayCtx & {
  readonly log: ReturnType<typeof createLog>;
  readonly registry: FakeRegistry;
  readonly channel: FakeChannel;
  readonly perf: FakePerf;
  readonly recorder: FakeRecorder;
  readonly graph: SpyGraph;
  readonly emitted: [string, unknown][];
};

/** The defaults of index.ts. */
export const DEFAULTS: Config = { mode: "hidden", dock: "right", remember: true, mount: undefined };

/**
 * A domain context over fresh state and fresh fakes.
 *
 * @param config - Config overrides.
 * @param commands - The manifest commands.
 * @returns The context.
 */
export function createOctx(
  config: Partial<Config> = {},
  commands: readonly CommandDescriptor[] = []
): TestOctx {
  const full: Config = { ...DEFAULTS, ...config };
  const state = createOverlayState({ config: full });
  const graph = spyGraph();
  const emitted: [string, unknown][] = [];
  return {
    config: full,
    state,
    log: createLog(),
    emit: ((name: string, payload: unknown) => {
      emitted.push([name, payload]);
    }) as OverlayCtx["emit"],
    emitted,
    registry: fakeRegistry(commands),
    channel: fakeChannel(),
    perf: fakePerf(),
    recorder: fakeRecorder(),
    graph,
    visitors: createVisitors(state, graph)
  };
}

/**
 * A plugin context over a test domain context; `require` answers the fakes by plugin name.
 *
 * @param octx - The test domain context.
 * @param hasBridge - What `has("bridge")` answers.
 * @returns The plugin context.
 */
export function pluginCtxOf(octx: TestOctx, hasBridge = false): OverlayPluginCtx {
  const apis = new Map<string, unknown>([
    ["registry", octx.registry],
    ["channel", octx.channel],
    ["perf", octx.perf],
    ["recorder", octx.recorder]
  ]);
  const require = ((plugin: { readonly name: string }) =>
    apis.get(plugin.name)) as unknown as Require;
  return {
    config: octx.config,
    state: octx.state,
    log: octx.log,
    emit: octx.emit,
    require,
    has: name => hasBridge && name === "bridge"
  };
}

/**
 * The `overlay:changed` payloads a context emitted.
 *
 * @param octx - The test context.
 * @returns The payloads, in order.
 */
export function changes(octx: TestOctx): unknown[] {
  return octx.emitted.filter(([name]) => name === "overlay:changed").map(([, payload]) => payload);
}

/**
 * Starts a test context on the happy-dom document (host, shadow root, listeners, the global).
 *
 * @param octx - The test context.
 * @param hasBridge - What the plugin would read from `has("bridge")`.
 * @returns The same context, started.
 */
export function started(octx: TestOctx, hasBridge = false): TestOctx {
  startOverlayWith(octx, hasBridge, document);
  return octx;
}

/**
 * Stops a started test context (as onStop does).
 *
 * @param octx - The test context.
 */
export function stopped(octx: TestOctx): void {
  stopOverlay({ state: octx.state });
}

/**
 * The shadow root of a started context.
 *
 * @param octx - The test context.
 * @returns The root.
 */
export function shadowOf(octx: TestOctx): ShadowRoot {
  const root = octx.state.root;
  if (root === undefined) throw new Error("the overlay is not mounted");
  return root;
}

/**
 * One element of the shadow root.
 *
 * @param octx - The test context.
 * @param selector - The selector.
 * @returns The element.
 */
export function part<Element extends HTMLElement = HTMLElement>(
  octx: TestOctx,
  selector: string
): Element {
  const element = shadowOf(octx).querySelector<Element>(selector);
  if (element === null) throw new Error(`no ${selector} in the overlay`);
  return element;
}
