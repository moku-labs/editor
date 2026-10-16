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
import type { LinkStatus } from "../../../registry/protocol";
import { RenderWorkspace } from "../../components/RenderWorkspace";
import { newestEnd } from "../../series/rows";
import { appendEvents, appendFrames } from "../../source/contract";
import { notifyMission } from "../../state";
import { noteArrival } from "../../view/clock";
import {
  DEMO_FIRST,
  demoDirectory,
  demoEvents,
  demoFrames,
  demoPasses,
  demoRecorder,
  demoSecond
} from "../device-fixtures";
import { type MotionQuery, type ResizeQueue, stubMotion, stubResizeObserver } from "../helpers";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { PALETTE } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// spec 10 Delta 2026-10-16 "memory-leak tests", M2 renderView, with Mission
// control mounted (spec 09 § M16): the paint loop over every canvas of the
// Render workspace (10 000 ticks with a fake rAF, the real painters into a
// no-op context, new frames once a second) and 100 mount / unmount cycles of
// the workspace keep the heap within 256 KiB; after each unmount no rAF is
// queued, the ResizeObserver is released, the reduced-motion and Mission
// control listeners are gone and the DOM nodes are back.
// ─────────────────────────────────────────────────────────────────────────────

// The loop reads its colours with getComputedStyle once per start (20 tokens). happy-dom keeps about
// 40 objects per computed-style read alive after the element left the document (its style cache),
// which a browser releases; that would read as ~4 400 objects per 100 mounts here. The palette read
// is timeline/palette's own test; this file measures what the workspace itself keeps.
vi.mock("../../timeline/palette", async original => ({
  ...(await original<typeof import("../../timeline/palette")>()),
  readPalette: () => PALETTE
}));

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
 * Warm-up ticks before the baseline read. Under Bun the heap settles only after many frames (JIT
 * tiers, structure caches; the old strip read +240 to +400 KiB after 1 000 and about +50 KiB after
 * 10 000 with a flat object count). With the whole workspace re-rendering once a second the reads of
 * the first 30 000 ticks still swing by hundreds of KiB while the live object count stays flat.
 */
const LOOP_WARMUP = 20_000;

/** Mount / unmount cycles before the baseline read. */
const MOUNT_WARMUP = 250;

/** A measurement runs thousands of frames: more than vitest's default 5 s. */
const MEASURE_TIMEOUT_MS = 90_000;

/** The link status the workspace is shown with. */
const LIVE: LinkStatus = { kind: "live", frame: 4960 };

/** What the no-op context's `measureText` answers. */
const MEASURED = { width: 10 };

/** A 2D context that takes every call and allocates nothing per call. */
const NO_OP_CONTEXT = new Proxy(
  { measureText: (): { width: number } => MEASURED },
  {
    get: (target, key) => (key in target ? Reflect.get(target, key) : stopNothing),
    set: () => true
  }
);

let ctx: MissionCtx;
let host: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let nextHandle: number;
let ticks: number;
let motion: MotionQuery;
let sizes: ResizeQueue;
let newest: number;

/**
 * Does nothing: the no-op context's every method.
 */
function stopNothing(): void {}

/**
 * Forgets the calls the mocks recorded, before each read: the records are the test's own memory.
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
 * The phone's next second: 60 more frames, their arrival on the display clock, a new second.
 */
function nextSecond(): void {
  const { mission } = ctx.state;
  appendFrames(mission.history, demoFrames(newest, newest + 60));
  newest += 60;
  noteArrival(mission.clock, newestEnd(mission.history) ?? 0, performance.now());
  mission.second = demoSecond(newest);
  act(() => notifyMission(mission));
}

/**
 * Mounts the Render workspace into the host.
 */
function mount(): void {
  act(() => {
    render(h(RenderWorkspace, { ctx, status: LIVE, workspace: ctx.workspace.api }), host);
  });
}

/**
 * Unmounts it.
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

  ctx = missionCtx({ device: true });
  ctx.activeSource.directoryValue = demoDirectory();
  const { mission } = ctx.state;
  newest = DEMO_FIRST + 359;
  appendFrames(mission.history, demoFrames(undefined, newest));
  appendEvents(mission.history, demoEvents(undefined, newest));
  mission.second = demoSecond(newest);
  mission.passes = demoPasses(newest);
  mission.recorder = demoRecorder();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  unmount();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the Render workspace's memory with Mission control (spec 10 Delta 2026-10-16, M2)", () => {
  it(
    "10 000 ticks of the paint loop keep the heap within 256 KiB",
    async () => {
      mount();
      nextSecond();

      const growth = await measureGrowth(
        round => {
          vi.advanceTimersByTime(FRAME_MS);
          if (round % 60 === 0) nextSecond();
          runFrame();
        },
        { warmup: LOOP_WARMUP, rounds: 10_000, settle: clearCalls, ceiling: CEILING }
      );

      logLeak("renderView Mission control loop (10 000 ticks)", { ...growth, counts: { ticks } });
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
      const subscribers = ctx.state.mission.listeners.size;
      const left = { frames: 0, observers: 0, motion: 0, prefs: 0, subscribers: 0, nodes: 0 };

      const growth = await measureGrowth(
        () => {
          mount();
          nextSecond();
          runFrame();
          runFrame();
          unmount();
          left.frames = Math.max(left.frames, frames.size);
          left.observers = Math.max(left.observers, sizes.observed());
          left.motion = Math.max(left.motion, motion.listeners());
          left.prefs = Math.max(left.prefs, ctx.workspace.prefsListeners.size - prefs);
          left.subscribers = Math.max(
            left.subscribers,
            ctx.state.mission.listeners.size - subscribers
          );
          left.nodes = Math.max(left.nodes, nodeCount() - nodes);
        },
        { warmup: MOUNT_WARMUP, rounds: 100, settle: clearCalls, ceiling: CEILING }
      );

      logLeak("renderView Mission control mount/unmount (100 cycles)", {
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
