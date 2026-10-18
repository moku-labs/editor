/**
 * @file overlay plugin — the tick and the agent bracket. One function renders, `paintNow`: the
 * Preact view and the graph, between `monitor.beginAgent()` and `endAgent()` (the end also after a
 * throw, logged once), so the engine charges the overlay to the `agent` phase. The tick is one
 * `setInterval(PAINT_MS)` while the window shows and the page is visible; data that arrives
 * between ticks is stored, never rendered.
 */
import type { OverlayCtx, OverlayState } from "../types";
import { PAINT_MS } from "../types";
import { paintGraphNow } from "./graph";
import { renderOverlay } from "./render";

/**
 * Runs work inside the engine's agent span (a nested begin is ignored by the engine).
 *
 * @param octx - Domain context.
 * @param work - The work.
 */
export function withAgent(octx: OverlayCtx, work: () => void): void {
  const monitor = octx.perf.monitor();
  monitor?.beginAgent();
  try {
    work();
  } finally {
    monitor?.endAgent();
  }
}

/**
 * Renders the overlay and paints its graph now, inside the agent bracket. Nothing before mount or
 * while hidden. A throw is logged once (`overlay:paint-failed`); the tick keeps running.
 *
 * @param octx - Domain context.
 */
export function paintNow(octx: OverlayCtx): void {
  const { state } = octx;
  if (state.container === undefined || state.mode === "hidden") return;
  withAgent(octx, () => {
    try {
      renderOverlay(octx);
      paintGraphNow(octx);
    } catch (error) {
      if (state.paintFailed) return;
      state.paintFailed = true;
      octx.log.warn("overlay:paint-failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

/**
 * One tick: ends the slide, drops an expired toast, renders.
 *
 * @param octx - Domain context.
 */
export function tickOnce(octx: OverlayCtx): void {
  const { state } = octx;
  if (state.opening) {
    state.opening = false;
    state.host?.toggleAttribute("data-opening", false);
  }
  if (state.toast !== undefined && state.toast.until <= Date.now()) state.toast = undefined;
  paintNow(octx);
}

/**
 * Starts the tick while the window shows and the page is visible. Idempotent.
 *
 * @param octx - Domain context.
 */
export function startTick(octx: OverlayCtx): void {
  const { state } = octx;
  const hidden = state.host?.ownerDocument.visibilityState === "hidden";
  if (state.tick !== undefined || state.mode === "hidden" || hidden) return;
  state.tick = setInterval(() => {
    tickOnce(octx);
  }, PAINT_MS);
}

/**
 * Stops the tick. Idempotent.
 *
 * @param state - Overlay state.
 */
export function stopTick(state: OverlayState): void {
  clearInterval(state.tick);
  state.tick = undefined;
}

/**
 * Stops the tick while the page is hidden and restarts it (with a render) when it shows again.
 *
 * @param octx - Domain context.
 * @param doc - The document.
 */
export function watchVisibility(octx: OverlayCtx, doc: Document): void {
  const { state } = octx;
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") {
      stopTick(state);
      return;
    }
    startTick(octx);
    paintNow(octx);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  state.off.push(() => {
    doc.removeEventListener("visibilitychange", onVisibility);
  });
}

/**
 * Ends the slide when its animation ends (before the next tick).
 *
 * @param state - Overlay state.
 * @param root - The shadow root.
 */
export function watchSlide(state: OverlayState, root: ShadowRoot): void {
  const onEnd = (): void => {
    state.opening = false;
    state.host?.toggleAttribute("data-opening", false);
  };
  root.addEventListener("animationend", onEnd);
  state.off.push(() => {
    root.removeEventListener("animationend", onEnd);
  });
}
