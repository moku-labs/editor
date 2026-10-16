// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphState, paintGraph } from "../../device/contract";
import { STALE_AFTER_MS, type StripCanvas, startRepaint } from "../../device/paint";
import { createPlayout, notePlayoutArrival } from "../../device/playout";
import { clearStripData } from "../../device/state";
import { onWorkspaceChanged } from "../../handlers";
import { startTracker } from "../../watch";
import { DEVICE, deviceSession, windowWire, wireJson } from "../device-fixtures";
import {
  createCtx,
  GAME_01_SOURCES,
  manifestOf,
  stubMotion,
  stubResizeObserver,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// device/paint.ts + device/playout.ts, spec 09 Amendment 2026-10-16: the strip
// draws at a display clock that runs at real time a playout delay behind the
// newest row (a jitter buffer), so the graph never stands still between two
// window arrivals (about 1 Hz). The agent's arrivals and the animation frames
// run on fake timers and a fake requestAnimationFrame; the painter is mocked
// and each painted frame's right edge (`nowMs`) and span (`spanMs`) are kept.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../device/contract", async importOriginal => {
  const actual = await importOriginal<typeof import("../../device/contract")>();
  return { ...actual, paintGraph: vi.fn() };
});

/** One animation frame, ms. */
const FRAME_MS = 16;

/** The game page's clock when the test starts: the agent's windows end at it plus the elapsed time. */
const GAME_ZERO = 100_000;

/** The span of every window the agent sends (perf's `windowMs`). */
const WINDOW_MS = 6000;

/** The delay before two arrivals were measured (spec 09 Amendment 2026-10-16, item 2). */
const START_DELAY_MS = 1000;

/**
 * One painted frame: when, its right edge, the clock's target (the newest row's end plus the time
 * since it arrived, less the delay) and span, and the window it painted.
 */
type Shot = {
  readonly at: number;
  readonly now: number;
  readonly target: number;
  readonly span: number;
  readonly startMs: number;
  readonly endMs: number;
};

let ctx: TestCtx;
let frames: (() => void)[];
let shots: Shot[];
let elapsed: number;

/**
 * The strip's canvas: a canvas element with a context that takes every call.
 *
 * @returns The canvas.
 */
function canvasOf(): HTMLCanvasElement {
  const g = new Proxy(
    { measureText: () => ({ width: 10 }) },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : () => {}), set: () => true }
  );
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => ({ width: 1000, height: 200 }) as DOMRect;
  canvas.getContext = (() => g) as never;
  return canvas;
}

/**
 * Starts the loop on a new test canvas with an offscreen layer.
 *
 * @returns The cleanup.
 */
function start(): () => void {
  const layer: StripCanvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 1000, height: 200 }),
    getContext: () => canvasOf().getContext("2d") as never
  };
  return startRepaint(ctx, canvasOf(), createGraphState(1024), () => layer as never);
}

/**
 * Sends the agent's window value whose newest row ends `at` ms after the test started.
 *
 * @param at - Elapsed ms.
 * @param zero - The game clock at the test's start.
 */
function deliver(at: number, zero: number): void {
  const endMs = zero + at;
  ctx.link.send(
    "editor.perf.window",
    wireJson({ ...windowWire(), startMs: endMs - WINDOW_MS, endMs })
  );
}

/**
 * Runs the queued animation frames once.
 */
function runFrames(): void {
  const queue = frames;
  frames = [];
  for (const run of queue) run();
}

/**
 * Plays the agent's arrivals (elapsed ms, ascending) with one animation frame every 16 ms until
 * `untilMs`: an arrival is delivered at its own time, between two frames.
 *
 * @param arrivals - When each window arrives.
 * @param untilMs - Elapsed ms of the last frame.
 * @param zero - The game clock at the test's start.
 */
function play(arrivals: readonly number[], untilMs: number, zero = GAME_ZERO): void {
  let index = arrivals.findIndex(at => at > elapsed);
  if (index < 0) index = arrivals.length;
  while (elapsed + FRAME_MS <= untilMs) {
    const next = elapsed + FRAME_MS;
    for (let at = arrivals[index]; at !== undefined && at <= next; at = arrivals[index]) {
      vi.advanceTimersByTime(at - elapsed);
      elapsed = at;
      deliver(at, zero);
      index += 1;
    }
    vi.advanceTimersByTime(next - elapsed);
    elapsed = next;
    runFrames();
  }
}

/**
 * The right edge's advance from each painted frame to the next, ms.
 *
 * @param list - The frames.
 * @returns One advance per pair.
 */
function advances(list: readonly Shot[]): number[] {
  return list.slice(1).map((shot, index) => shot.now - (list[index]?.now ?? shot.now));
}

/**
 * Arrival times from a list of gaps, the first at 0.
 *
 * @param gaps - ms between two arrivals.
 * @returns Elapsed ms of each arrival.
 */
function arrivalsOf(gaps: readonly number[]): number[] {
  const times = [0];
  for (const gap of gaps) times.push((times.at(-1) ?? 0) + gap);
  return times;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"]
  });
  frames = [];
  shots = [];
  elapsed = -1;
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    frames.push(run);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  stubMotion(false);
  stubResizeObserver();
  vi.stubGlobal("devicePixelRatio", 1);
  vi.mocked(paintGraph).mockReset();
  vi.mocked(paintGraph).mockImplementation((_g, window, view) => {
    if (view.layer !== "over" || view.nowMs === undefined) return;
    const { windowAt, playout } = ctx.state.device;
    shots.push({
      at: elapsed,
      now: view.nowMs,
      target: window.endMs + (performance.now() - (windowAt ?? 0)) - playout.delayMs,
      span: view.spanMs ?? Number.NaN,
      startMs: window.startMs,
      endMs: window.endMs
    });
  });
  ctx = createCtx();
  ctx.link.api.sessions = () => [deviceSession("s-1", DEVICE)];
  ctx.link.api.session = () => "s-1";
  ctx.link.manifestValue = manifestOf([
    ...GAME_01_SOURCES,
    "editor.perf.second",
    "editor.perf.window"
  ]);
  startTracker(ctx);
  onWorkspaceChanged(ctx)({ ws: "render" });
});

afterEach(() => {
  ctx.state.device.stopPaint?.();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the playout clock (spec 09 Amendment 2026-10-16)", () => {
  it("a 1 Hz stream: the right edge advances every frame by about the frame's time, never stands, never steps back, never passes the newest row", () => {
    start();
    play(arrivalsOf(Array.from({ length: 20 }, () => 1000)), 20_000);

    expect(shots.length).toBeGreaterThan(1000);
    expect(Math.min(...advances(shots))).toBeGreaterThan(0);
    // From the second arrival on the delay is measured: each frame moves by its own time, ± a trim.
    const settled = advances(shots.filter(shot => shot.at > 1000));
    expect(Math.min(...settled)).toBeGreaterThanOrEqual(FRAME_MS * 0.85);
    expect(Math.max(...settled)).toBeLessThanOrEqual(FRAME_MS * 1.15);
    expect(shots.every(shot => shot.now <= shot.endMs)).toBe(true);
    // The delay shrinks as the steady gaps are seen, and the plot gets the time back on its left.
    const spans = shots.map(shot => shot.span);
    expect(spans.at(-1) ?? 0).toBeGreaterThan(Math.min(...spans) + 100);
  });

  it("jittered arrivals (0.7–1.4 s) never freeze once the delay has adapted", () => {
    start();
    const arrivals = arrivalsOf([
      700, 700, 1400, 700, 1400, 1400, 700, 1400, 1000, 700, 1400, 1400, 900, 700, 1400
    ]);
    play(arrivals, arrivals.at(-1) ?? 0);

    // Before it adapted (the starting delay, then a buffer growing at a trimmed pace) a 1.4 s gap
    // may still run dry; from the fifth arrival on none does.
    expect(Math.min(...advances(shots))).toBeGreaterThanOrEqual(0);
    const adapted = advances(shots.filter(shot => shot.at > (arrivals[4] ?? 0)));
    expect(adapted.length).toBeGreaterThan(400);
    expect(Math.min(...adapted)).toBeGreaterThanOrEqual(FRAME_MS * 0.85);
    expect(shots.every(shot => shot.now <= shot.endMs)).toBe(true);
  });

  it("the plot's left edge never runs before the oldest row: its span is the window's less the delay", () => {
    start();
    play(arrivalsOf([700, 1400, 1000, 1000, 1300, 800, 1000, 1000, 1000, 1000]), 10_200);

    expect(shots.length).toBeGreaterThan(500);
    expect(shots.every(shot => shot.now - shot.span >= shot.startMs - 1e-6)).toBe(true);
    // The span is cut by the delay (250 to 1500 ms), not more: the scale does not zoom in.
    expect(Math.min(...shots.map(shot => shot.span))).toBeGreaterThanOrEqual(WINDOW_MS - 1600);
    expect(Math.max(...shots.map(shot => shot.span))).toBeLessThanOrEqual(WINDOW_MS - 250);
  });

  it("when the data stops, the right edge eases to a stop exactly at the newest row, then the loop stops", () => {
    start();
    play(arrivalsOf([1000, 1000, 1000, 1000, 1000]), 5100);
    play([], 5000 + STALE_AFTER_MS + 500);

    const endMs = GAME_ZERO + 5000;
    expect(shots.at(-1)?.now).toBe(endMs);
    expect(shots.every(shot => shot.now <= endMs)).toBe(true);
    const steps = advances(shots.filter(shot => shot.at > 5000));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    // A soft landing: the last moves shrink one after the other, the landing itself under 1.5 ms.
    const moving = steps.filter(step => step > 0);
    const easing = moving.slice(-6, -1);
    expect(easing).toEqual(easing.toSorted((a, b) => b - a));
    expect(easing.at(-1) ?? FRAME_MS).toBeLessThan(FRAME_MS * 0.25);
    expect(moving.at(-1) ?? FRAME_MS).toBeLessThan(1.5);
    expect(frames).toHaveLength(0);
  });

  it("a hidden tab coming back jumps the right edge forward onto its place, never backward", () => {
    start();
    const arrivals = arrivalsOf(Array.from({ length: 12 }, () => 1000));
    play(arrivals, 3000);
    const before = shots.at(-1)?.now ?? 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    play(arrivals, 8000);
    const hidden = shots.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    play(arrivals, 9000);

    const back = shots.slice(hidden);
    expect(back.length).toBeGreaterThan(30);
    expect(back[0]?.now ?? 0).toBeGreaterThan(before + 4000);
    // On its target: one delay behind the newest row, not run on through the time it was hidden.
    expect(back[0]?.now).toBeCloseTo(back[0]?.target ?? 0, 6);
    expect(back.every(shot => shot.now <= shot.endMs)).toBe(true);
    expect(Math.min(...advances(shots))).toBeGreaterThan(0);
    expect(Math.max(...advances(back))).toBeLessThanOrEqual(FRAME_MS * 1.15);
  });

  it("cleared data (a new session, a reloaded game) starts the playout over at the starting delay", () => {
    start();
    play(arrivalsOf([1000, 1000, 1000]), 3000);
    clearStripData(ctx.state.device);
    shots = [];

    // The new session's game clock is far behind the old one.
    const zero = 50_000;
    play([3001], 3400, zero);

    const first = shots.find(shot => shot.at > 3001);
    expect(first).toBeDefined();
    const since = (first?.at ?? 0) - 3001;
    expect(first?.now).toBeCloseTo(zero + 3001 + since - START_DELAY_MS, 6);
  });

  it("a canvas mounted again starts the playout over at the starting delay", () => {
    const stop = start();
    play(arrivalsOf([1000, 1000, 1000]), 3100);
    stop();
    shots = [];

    // The window of 3000 ms is still live: the new canvas draws it from the starting delay.
    start();
    play([], 3500);

    const first = shots[0];
    expect(first).toBeDefined();
    const since = (first?.at ?? 0) - 3000;
    expect(first?.now).toBeCloseTo(GAME_ZERO + 3000 + since - START_DELAY_MS, 6);
  });
});

describe("notePlayoutArrival", () => {
  it("a pause (Render hidden, the game stopped) is not an arrival gap: the delay stays", () => {
    const clock = createPlayout();
    notePlayoutArrival(clock, 0, 1000);
    notePlayoutArrival(clock, 1000, 2000);
    const delay = clock.delayMs;

    notePlayoutArrival(clock, 2000, 12_000);

    expect(clock.delayMs).toBe(delay);
    expect(clock.gapMs).toBe(1000);
  });
});
