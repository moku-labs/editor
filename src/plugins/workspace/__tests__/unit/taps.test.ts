// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameLayer, removeFrameLayer } from "../../frame/frame";
import { clearTaps, drawTap, MAX_RIPPLES, watchTaps } from "../../frame/taps";
import type { FrameBox } from "../../types";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Tap ripples: drawn in the frame overlay at the tap point (device px) while
// the frame is docked and Show taps is on; at most 8; gone after 400 ms
// (a static dot for 300 ms under reduced motion)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/** The frame box of a docked preview at scale 1. */
const DOCKED: FrameBox = { left: 0, top: 0, width: 393, height: 852, scale: 1, docked: "preview" };

/**
 * The ripples in the overlay.
 *
 * @returns The elements.
 */
function ripples(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-frame-overlay] [data-tap-ripple]")];
}

/**
 * Stubs `matchMedia` with a fixed answer for every query.
 *
 * @param matches - What every query answers.
 */
function stubMotion(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
  ctx = createCtx();
  createFrameLayer(ctx);
  ctx.state.frame.box = { ...DOCKED };
});

afterEach(() => {
  clearTaps(ctx.state);
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("drawTap", () => {
  it("draws a ring at the tap point in device px and removes it after 400 ms", () => {
    drawTap(ctx.state, { x: 120, y: 340, at: 1 });
    const [ripple] = ripples();
    expect(ripple?.dataset.tapRipple).toBe("ring");
    expect(ripple?.style.left).toBe("120px");
    expect(ripple?.style.top).toBe("340px");

    vi.advanceTimersByTime(399);
    expect(ripples()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ripples()).toHaveLength(0);
    expect(ctx.state.taps).toEqual([]);
  });

  it("under reduced motion draws a static dot for 300 ms", () => {
    stubMotion(true);
    drawTap(ctx.state, { x: 10, y: 20, at: 1 });
    expect(ripples()[0]?.dataset.tapRipple).toBe("dot");
    vi.advanceTimersByTime(300);
    expect(ripples()).toHaveLength(0);
  });

  it("keeps at most 8 ripples, removing the oldest first", () => {
    for (let index = 0; index < MAX_RIPPLES + 2; index += 1) {
      drawTap(ctx.state, { x: index, y: index, at: index });
    }
    expect(MAX_RIPPLES).toBe(8);
    expect(ripples()).toHaveLength(8);
    expect(ripples()[0]?.style.left).toBe("2px");
    expect(ctx.state.taps).toHaveLength(8);
  });

  it("draws nothing while the frame is hidden or before the first dock", () => {
    ctx.state.frame.box = { ...DOCKED, docked: "hidden" };
    drawTap(ctx.state, { x: 1, y: 1, at: 1 });
    ctx.state.frame.box = undefined;
    drawTap(ctx.state, { x: 1, y: 1, at: 1 });
    expect(ripples()).toHaveLength(0);
  });

  it("draws nothing with Show taps off or after stop", () => {
    ctx.state.showTaps = false;
    drawTap(ctx.state, { x: 1, y: 1, at: 1 });
    ctx.state.showTaps = true;
    ctx.state.stopped = true;
    drawTap(ctx.state, { x: 1, y: 1, at: 1 });
    expect(ripples()).toHaveLength(0);
  });

  it("also draws in the Game stage", () => {
    ctx.state.frame.box = { ...DOCKED, docked: "stage" };
    drawTap(ctx.state, { x: 5, y: 6, at: 1 });
    expect(ripples()).toHaveLength(1);
  });
});

describe("clearTaps", () => {
  it("removes every ripple and its timer", () => {
    drawTap(ctx.state, { x: 1, y: 1, at: 1 });
    drawTap(ctx.state, { x: 2, y: 2, at: 2 });
    const clear = vi.spyOn(globalThis, "clearTimeout");
    clearTaps(ctx.state);
    expect(ripples()).toHaveLength(0);
    expect(ctx.state.taps).toEqual([]);
    expect(clear).toHaveBeenCalledTimes(2);
  });
});

describe("watchTaps", () => {
  it("subscribes to link taps once and draws each; the remover unsubscribes", () => {
    const off = watchTaps(ctx);
    expect(ctx.link.onTap).toHaveBeenCalledTimes(1);
    ctx.link.tap({ x: 30, y: 40, at: 9 });
    expect(ripples()[0]?.style.left).toBe("30px");

    off();
    expect(ctx.link.tapListeners.size).toBe(0);
  });
});
