// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { createGraphState } from "../../device/contract";
import {
  clickGraph,
  REPAINT_MS,
  type StripCanvas,
  type StripContext,
  startRepaint
} from "../../device/paint";
import { onWorkspaceChanged } from "../../handlers";
import { startTracker } from "../../watch";
import { DEVICE, deviceSession, recordOf, windowWire, wireJson } from "../device-fixtures";
import {
  createCtx,
  type FrameQueue,
  GAME_01_SOURCES,
  manifestOf,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// device/paint.ts clickGraph with the real painter: a click that lands after a
// new window arrived and before the next repaint hits the boxes of the window
// it shows now, not the stale ones (review W3).
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;

/**
 * A 2D context that draws nothing; text is 6 px a character.
 *
 * @returns The context.
 */
function silentContext(): StripContext {
  return new Proxy(
    { measureText: (text: string) => ({ width: text.length * 6 }) },
    {
      get: (target, key) => (key in target ? Reflect.get(target, key) : () => {}),
      set: () => true
    }
  ) as unknown as StripContext;
}

/**
 * A strip canvas of 1000 × 200 CSS px.
 *
 * @returns The canvas.
 */
function canvasOf(): StripCanvas {
  const g = silentContext();
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 1000, height: 200 }),
    getContext: () => g
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"]
  });
  ctx = createCtx();
  ctx.link.api.sessions = () => [deviceSession("s-1", DEVICE)];
  ctx.link.api.session = () => "s-1";
  ctx.link.api.read = vi.fn((_id: string, input?: Json) => {
    const isInput = typeof input === "object" && input !== null && !Array.isArray(input);
    return Promise.resolve(toWireValue(recordOf({ frame: isInput ? Number(input.frame) : 0 })));
  });
  ctx.link.manifestValue = manifestOf([
    ...GAME_01_SOURCES,
    "editor.perf.second",
    "editor.perf.window",
    "editor.perf.spikes",
    "editor.perf.spike"
  ]);
  frames = stubFrames();
  startTracker(ctx);
  onWorkspaceChanged(ctx)({ ws: "render" });
});

afterEach(() => {
  ctx.state.device.stopPaint?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("clickGraph", () => {
  it("a click between a refill and the repaint opens the frame the graph shows now", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const graph = createGraphState(1024);
    startRepaint(ctx, canvasOf(), graph);
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    vi.advanceTimersByTime(REPAINT_MS);
    const flag = graph.flagRow.slice(0, graph.flagCount).indexOf(326);
    const x = ((graph.flagX0[flag] ?? 0) + (graph.flagX1[flag] ?? 0)) / 2;

    // 36 frames later: frame 4812 moved left, row 326 is now frame 4848, which is no spike.
    ctx.link.send("editor.perf.window", wireJson(windowWire(undefined, { first: 4522 })));
    clickGraph(ctx, graph, x, 10);

    expect(ctx.link.api.read).not.toHaveBeenCalledWith("editor.perf.spike", { frame: 4848 });
    expect(ctx.link.api.read).toHaveBeenCalledWith("editor.perf.spike", { frame: 4845 });
  });

  it("hit tests use the frame's own time origin: a click under a moving now selects the row drawn there", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const graph = createGraphState(1024);
    startRepaint(ctx, canvasOf(), graph);
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    vi.advanceTimersByTime(REPAINT_MS);
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    vi.advanceTimersByTime(200);
    frames.flush();
    const { window } = ctx.state.device;
    expect(graph.startMs).toBeCloseTo(window.endMs + 200 - (window.endMs - window.startMs));

    // Row 200 (frame 4686) as this frame drew it: 200 ms of the moving now further left.
    const at = (window.t[200] ?? 0) + 8;
    const x = graph.px0 + ((at - graph.startMs) / graph.spanMs) * (graph.px1 - graph.px0);
    clickGraph(ctx, graph, x, 150);

    expect(ctx.state.device.selected).toBe(4686);
  });
});
