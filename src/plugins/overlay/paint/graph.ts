/**
 * @file overlay plugin — the frame graph on its one canvas: the visitors handed to
 * `perf.readWindow` (made once per domain context, never an inline arrow per tick), the paint of
 * the graph (the backing store resized only on a size or dpr change) and the canvas mount. The
 * window never leaves a visitor: the overlay keeps frame numbers and answers in its state.
 */
import type { PerfWindowView } from "../../perf/protocol";
import { meanGpu, rowOfFrame, spikeOrdinal, stepSpike } from "../../perf/protocol";
import type { GraphSeam, OverlayCtx, OverlayState, Visitors } from "../types";

/** The largest device pixel ratio the backing store follows. */
const MAX_DPR = 3;

/**
 * The frame number of a row; undefined past the window.
 *
 * @param window - The window.
 * @param row - The row.
 * @returns The frame number.
 */
function frameAt(window: PerfWindowView, row: number): number | undefined {
  return window.frame[row];
}

/**
 * The row the selection (or the open record) points at now; −1 when it left the window.
 *
 * @param state - Overlay state.
 * @param window - The window.
 * @returns The row.
 */
function selectedRow(state: OverlayState, window: PerfWindowView): number {
  const frame = state.record ?? state.selected;
  return frame === undefined ? -1 : rowOfFrame(window, frame);
}

/**
 * Makes the four visitors of a domain context. Each reads its inputs from the state and writes its
 * answer there; none keeps the window.
 *
 * @param state - Overlay state.
 * @param graph - The painter seam.
 * @returns The visitors.
 */
export function createVisitors(state: OverlayState, graph: GraphSeam): Visitors {
  const paint = (window: PerfWindowView): void => {
    const canvas = state.canvas;
    if (canvas === undefined) return;
    if (state.graph === undefined || state.graph.flagRow.length < window.capacity) {
      state.graph = graph.createState(window.capacity);
    }
    const row = state.selected === undefined ? -1 : rowOfFrame(window, state.selected);
    const painted = state.painted;
    const same =
      window.version === painted.version &&
      row === painted.row &&
      canvas.w === painted.w &&
      canvas.h === painted.h &&
      canvas.dpr === painted.dpr;
    if (same) return;

    const view = state.graphView;
    view.width = canvas.w;
    view.height = canvas.h;
    view.selected = row;
    canvas.g.setTransform(canvas.dpr, 0, 0, canvas.dpr, 0, 0);
    graph.paint(canvas.g, window, view, state.graph);
    painted.version = window.version;
    painted.row = row;
    painted.w = canvas.w;
    painted.h = canvas.h;
    painted.dpr = canvas.dpr;
  };

  const nav = (window: PerfWindowView): void => {
    const from = selectedRow(state, window);
    const to = stepSpike(window, from < 0 ? window.count - 1 : from, state.probe.dir);
    const frame = to < 0 ? undefined : frameAt(window, to);
    if (frame === undefined) return;
    if (state.record !== undefined) state.record = frame;
    state.selected = frame;
  };

  const hit = (window: PerfWindowView): void => {
    if (state.graph === undefined || window.count === 0) return;
    const spike = graph.spikeAt(state.graph, window, state.probe.x, state.probe.y);
    if (spike >= 0) {
      state.record = frameAt(window, spike);
      state.selected = state.record;
      return;
    }
    const row = graph.rowAt(state.graph, window, state.probe.x);
    if (row >= 0) state.selected = frameAt(window, row);
  };

  const count = (window: PerfWindowView): void => {
    const facts = state.facts;
    facts.gpuAvg = meanGpu(window) ?? undefined;
    facts.total = window.spikeCount;
    facts.count = window.count;
    facts.gpuTimer = window.gpuTimer;
    const frame = state.record ?? state.selected;
    facts.row = frame === undefined ? window.count - 1 : rowOfFrame(window, frame);
    facts.ordinal = facts.row < 0 ? 0 : spikeOrdinal(window, facts.row);
  };

  return { paint, nav, hit, count };
}

/**
 * The page's device pixel ratio, clamped to 1…3.
 *
 * @returns The ratio.
 * @example
 * ```ts
 * pixelRatio(); // 2 on a retina display
 * ```
 */
function pixelRatio(): number {
  return Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1));
}

/**
 * Paints the graph when it shows: sets the backing store when the CSS size or the dpr changed,
 * then hands the paint visitor to `perf.readWindow` once. No layout read.
 *
 * @param octx - Domain context.
 */
export function paintGraphNow(octx: OverlayCtx): void {
  const canvas = octx.state.canvas;
  if (canvas === undefined) return;

  const dpr = pixelRatio();
  if (
    dpr !== canvas.dpr ||
    octx.state.painted.w !== canvas.w ||
    octx.state.painted.h !== canvas.h
  ) {
    canvas.dpr = dpr;
    canvas.element.width = Math.round(canvas.w * dpr);
    canvas.element.height = Math.round(canvas.h * dpr);
  }
  octx.perf.readWindow(octx.visitors.paint);
}

/**
 * The canvas ref of the graph well: mounts the one canvas (its context, a size from the design
 * until the ResizeObserver reports one) or drops it with its painter state.
 *
 * @param octx - Domain context.
 * @param element - The canvas, or null when it unmounted.
 * @param size - The design size of the well (CSS px), used until the observer measures.
 * @param size.w - Width.
 * @param size.h - Height.
 */
export function mountCanvas(
  octx: OverlayCtx,
  element: HTMLCanvasElement | null,
  size: { readonly w: number; readonly h: number }
): void {
  const { state } = octx;
  if (element === null) {
    dropCanvas(state);
    return;
  }
  if (state.canvas?.element === element) return;

  const g = octx.graph.context(element);
  if (g === undefined) return;
  state.canvas = { element, g, w: size.w, h: size.h, dpr: 0 };
  state.graph = undefined;
  state.painted.version = -1;
  observeCanvas(state, element);
}

/**
 * Follows the canvas's CSS size with a ResizeObserver (none in a test runtime without one).
 *
 * @param state - Overlay state.
 * @param element - The canvas.
 */
function observeCanvas(state: OverlayState, element: HTMLCanvasElement): void {
  if (typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(entries => {
    const box = entries[0]?.contentRect;
    const canvas = state.canvas;
    if (box === undefined || canvas === undefined || box.width === 0 || box.height === 0) return;
    canvas.w = box.width;
    canvas.h = box.height;
  });
  observer.observe(element);
  canvasObservers.set(state, observer);
}

/** The observer of each state's canvas, disconnected with the canvas. */
const canvasObservers = new WeakMap<OverlayState, ResizeObserver>();

/**
 * Drops the canvas and its painter state (the record, another tab, the pill, hidden).
 *
 * @param state - Overlay state.
 */
export function dropCanvas(state: OverlayState): void {
  canvasObservers.get(state)?.disconnect();
  canvasObservers.delete(state);
  state.canvas = undefined;
  state.graph = undefined;
  state.painted.version = -1;
}
