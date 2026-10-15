// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact unmounts by rendering null */
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  heapMeasured,
  logLeak,
  measureGrowth
} from "../../../../../tests/integration/helpers/heap";
import type { Json, LinkStatus, SessionInfo } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { DeviceStrip } from "../../device/components/DeviceStrip";
import { REPAINT_MS } from "../../device/paint";
import { createHandlers } from "../../handlers";
import { startRenderView, stopRenderView } from "../../lifecycle";
import {
  COMPUTER_ENGINE,
  DEVICE,
  deviceSession,
  recorderOf,
  secondOf,
  spikesOf,
  windowWire,
  wireJson
} from "../device-fixtures";
import {
  createCtx,
  GAME_01_SOURCES,
  type MotionQuery,
  manifestOf,
  type ResizeQueue,
  stubMotion,
  stubResizeObserver,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 10 Delta 2026-10-16 "memory-leak tests", M2 renderView: the device strip's
// requestAnimationFrame loop (10 000 ticks with a fake rAF, the real painter
// into a no-op context) and 100 mount / unmount cycles of the strip keep the
// heap within 256 KiB; after each unmount no rAF is queued, the ResizeObserver
// is disconnected, the reduced-motion listener and the theme listener are gone,
// the strip has no subscriber left and the DOM nodes are back.
// ─────────────────────────────────────────────────────────────────────────────

/** The heap ceiling of both measurements (spec 10 M2), bytes. */
const HEAP_CEILING = 256 * 1024;

/**
 * The ceiling handed to `measureGrowth`: a reading over it is measured again (up to three windows),
 * so a leak fails in every window and the noise of a loaded machine in one does not.
 */
const CEILING = { heapBytes: HEAP_CEILING };

/** One animation frame at 60 Hz, ms. */
const FRAME_MS = 16;

/**
 * Warm-up frames before the baseline read. Under Bun the heap settles only after thousands of
 * frames (JIT tiers, structure caches): with 1 000 the same run read +240 to +400 KiB and with
 * 5 000 about +150 KiB while the live object count stayed flat; with 10 000 it reads about +50 KiB.
 * Over 2 000 mount cycles the object count is flat from cycle 250 on.
 */
const LOOP_WARMUP = 10_000;

/** Mount / unmount cycles before the baseline read (see `LOOP_WARMUP`). */
const MOUNT_WARMUP = 250;

/** A measurement runs thousands of frames: more than vitest's default 5 s. */
const MEASURE_TIMEOUT_MS = 60_000;

/** The device sources of an agent with perf and the recorder. */
const PERF_SOURCES = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.perf.spike",
  "editor.recorder"
];

/** The link status the strip is shown with. */
const LIVE: LinkStatus = { kind: "live", frame: 4845 };

/** A 2D context that takes every call and allocates nothing per call. */
const NO_OP_CONTEXT = new Proxy(
  { measureText: (): { width: number } => MEASURED },
  {
    get: (target, key) => (key in target ? Reflect.get(target, key) : stopNothing),
    set: () => true
  }
);

/** What the no-op context's `measureText` answers. */
const MEASURED = { width: 10 };

let ctx: TestCtx;
let host: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let nextHandle: number;
let ticks: number;
let motion: MotionQuery;
let sizes: ResizeQueue;
let windowValue: Json;
let secondValue: Json;

/**
 * Does nothing: the no-op context's every method.
 */
function stopNothing(): void {}

/**
 * Forgets the calls the mocks and spies recorded, before each read: the records are the test's own
 * memory, not the strip's.
 */
function clearCalls(): void {
  vi.clearAllMocks();
}

/**
 * Runs the queued animation frames once, as the browser does on one display refresh.
 */
function runFrame(): void {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) {
    ticks += 1;
    callback(performance.now());
  }
}

/**
 * Mounts the device strip into the host.
 */
function mount(): void {
  act(() => {
    render(h(DeviceStrip, { ctx, status: LIVE }), host);
  });
}

/**
 * Unmounts the device strip.
 */
function unmount(): void {
  act(() => {
    render(null, host);
  });
}

/**
 * The element count of the document.
 *
 * @returns The count.
 */
function nodeCount(): number {
  return document.querySelectorAll("*").length;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"]
  });
  frames = new Map();
  nextHandle = 0;
  ticks = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextHandle += 1;
    frames.set(nextHandle, callback);
    return nextHandle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    frames.delete(handle);
  });
  vi.stubGlobal("devicePixelRatio", 2);
  motion = stubMotion(false);
  sizes = stubResizeObserver();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(NO_OP_CONTEXT as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 200
  } as DOMRect);

  ctx = createCtx();
  const sessions: SessionInfo[] = [deviceSession("s-1", DEVICE)];
  ctx.link.api.sessions = () => sessions;
  ctx.link.api.session = () => "s-1";
  ctx.link.api.engine = () => COMPUTER_ENGINE;
  ctx.link.manifestValue = manifestOf([...GAME_01_SOURCES, ...PERF_SOURCES]);
  startRenderView(ctx);
  createHandlers(ctx)["workspace:changed"]({ ws: "render" });
  windowValue = wireJson(windowWire());
  secondValue = toWireValue(secondOf());
  ctx.link.send("editor.perf.second", secondValue);
  ctx.link.send("editor.perf.window", windowValue);
  ctx.link.send("editor.perf.spikes", toWireValue(spikesOf()));
  ctx.link.send("editor.recorder", toWireValue(recorderOf()));
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  unmount();
  host.remove();
  stopRenderView(ctx);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the device strip's memory (spec 10 Delta 2026-10-16, M2)", () => {
  it(
    "10 000 ticks of the requestAnimationFrame loop keep the heap within 256 KiB",
    async () => {
      mount();
      vi.advanceTimersByTime(REPAINT_MS);

      const growth = await measureGrowth(
        round => {
          vi.advanceTimersByTime(FRAME_MS);
          // The agent's reads: a window every 250 ms, a second every 1 s (the loop stays live).
          if (round % 15 === 0) ctx.link.send("editor.perf.window", windowValue);
          if (round % 60 === 0) ctx.link.send("editor.perf.second", secondValue);
          runFrame();
        },
        { warmup: LOOP_WARMUP, rounds: 10_000, settle: clearCalls, ceiling: CEILING }
      );

      logLeak("renderView strip rAF loop (10 000 ticks)", { ...growth, counts: { ticks } });
      expect(ticks).toBeGreaterThanOrEqual(LOOP_WARMUP + 10_000);
      expect(frames.size).toBe(1);
      if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(HEAP_CEILING);
    },
    MEASURE_TIMEOUT_MS
  );

  it(
    "100 mount / unmount cycles release the loop, the observer, the listeners and the nodes",
    async () => {
      const nodes = nodeCount();
      const prefs = ctx.workspace.prefsListeners.size;
      const subscribers = ctx.state.device.listeners.size;
      const left = { frames: 0, observers: 0, motion: 0, prefs: 0, subscribers: 0, nodes: 0 };

      const growth = await measureGrowth(
        () => {
          mount();
          ctx.link.send("editor.perf.window", windowValue);
          vi.advanceTimersByTime(REPAINT_MS);
          runFrame();
          runFrame();
          unmount();
          left.frames = Math.max(left.frames, frames.size);
          left.observers = Math.max(left.observers, sizes.observed());
          left.motion = Math.max(left.motion, motion.listeners());
          left.prefs = Math.max(left.prefs, ctx.workspace.prefsListeners.size - prefs);
          left.subscribers = Math.max(
            left.subscribers,
            ctx.state.device.listeners.size - subscribers
          );
          left.nodes = Math.max(left.nodes, nodeCount() - nodes);
        },
        { warmup: MOUNT_WARMUP, rounds: 100, settle: clearCalls, ceiling: CEILING }
      );

      logLeak("renderView strip mount/unmount (100 cycles)", {
        ...growth,
        counts: { nodes: left.nodes, listeners: left.motion + left.prefs + left.subscribers, ticks }
      });
      expect(ticks).toBeGreaterThanOrEqual(2 * (MOUNT_WARMUP + 100));
      expect(left).toEqual({
        frames: 0,
        observers: 0,
        motion: 0,
        prefs: 0,
        subscribers: 0,
        nodes: 0
      });
      if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(HEAP_CEILING);
    },
    MEASURE_TIMEOUT_MS
  );
});
