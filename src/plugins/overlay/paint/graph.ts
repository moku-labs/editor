/**
 * @file overlay plugin — the frame graph on its two canvases (the plot, which slides, and the fixed
 * canvas laid over the whole well, which does not): the visitors handed to `perf.readWindow` (made
 * once per domain context, never an inline arrow per tick), the paint of both in one visit (each
 * backing store resized only on a size or dpr change) and the canvas mounts. The window never
 * leaves a visitor: the overlay keeps frame numbers and answers in its state.
 */
import type { PerfWindowView } from "../../perf/protocol";
import { meanGpu, rowOfFrame, spikeOrdinal, stepSpike } from "../../perf/protocol";
import type { GraphCanvas, GraphSeam, OverlayCtx, OverlayState, Visitors } from "../types";
import { PAINT_MS } from "../types";
import { slideAllowed, startSlide } from "./slide";

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
 * Paints the fixed canvas after the plot, in the same visit, at the well's size and the plot's dpr,
 * without a lead: the tape and its readout, the caption, `now` and the stack legend, cleared first
 * (the rest of it shows the plot sliding under it). The backing store is resized only when the size
 * or the dpr changed.
 *
 * @param state - Overlay state.
 * @param graph - The painter seam.
 * @param window - The window.
 * @param canvas - The plot canvas just painted.
 */
function paintFixed(
  state: OverlayState,
  graph: GraphSeam,
  window: PerfWindowView,
  canvas: GraphCanvas
): void {
  const fixed = state.fixed;
  if (fixed === undefined) return;
  // The fixed layer keeps no flags: a painter state of one row, made once.
  state.fixedGraph ??= graph.createState(1);
  const { w, h, dpr } = canvas;
  if (w !== fixed.w || h !== fixed.h || dpr !== fixed.dpr) {
    fixed.w = w;
    fixed.h = h;
    fixed.dpr = dpr;
    fixed.element.width = Math.round(w * dpr);
    fixed.element.height = Math.round(h * dpr);
  }
  const view = state.fixedView;
  view.width = w;
  view.height = h;
  view.selected = state.graphView.selected;
  fixed.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  fixed.g.clearRect(0, 0, w, h);
  graph.paint(fixed.g, window, view, state.fixedGraph);
}

/**
 * A GPU time the headline can print: finite, else undefined.
 *
 * @param ms - The time, ms.
 * @returns It, or undefined.
 */
function finiteMs(ms: number | undefined): number | undefined {
  return ms !== undefined && Number.isFinite(ms) ? ms : undefined;
}

/**
 * The slide of a paint: one tick's distance at the window's scale, rounded; none under reduced
 * motion, for an empty window or one without a time span, and never more than the well's width
 * (review W3: an empty window's scale made a 59 000 px canvas).
 *
 * @param window - The window.
 * @param canvas - The plot canvas.
 * @param graph - The painter seam.
 * @returns CSS px, 0 to the well's width.
 */
function slideLead(window: PerfWindowView, canvas: GraphCanvas, graph: GraphSeam): number {
  if (!canvas.motion || window.count === 0 || window.endMs <= window.startMs) return 0;
  const lead = Math.round(graph.msToPx(window, canvas.w, false, PAINT_MS));
  return Number.isFinite(lead) ? Math.min(Math.max(lead, 0), canvas.w) : 0;
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
    // No canvas mounted (the pill, another tab, the record): nothing to paint.
    const canvas = state.canvas;
    if (canvas === undefined) return;
    // The painter's state, made once per canvas and sized for the window's rows.
    if (state.graph === undefined || state.graph.flagRow.length < window.capacity) {
      state.graph = graph.createState(window.capacity);
    }
    // The slide: one tick's distance at this scale, painted past the well's right edge.
    const lead = slideLead(window, canvas, graph);
    const width = canvas.w + lead;
    // Skip a paint that would draw the same: window version, selection, size, dpr (a paused game costs nothing).
    const row = state.selected === undefined ? -1 : rowOfFrame(window, state.selected);
    const painted = state.painted;
    const same =
      window.version === painted.version &&
      row === painted.row &&
      width === painted.w &&
      canvas.h === painted.h &&
      canvas.nextDpr === painted.dpr;
    if (same) return;

    // The backing store, only when the painted size or the dpr changed.
    if (width !== painted.w || canvas.h !== painted.h || canvas.nextDpr !== canvas.dpr) {
      canvas.dpr = canvas.nextDpr;
      canvas.element.width = Math.round(width * canvas.dpr);
      canvas.element.height = Math.round(canvas.h * canvas.dpr);
      canvas.element.style.setProperty("width", `${width}px`);
    }
    // Paint through the reused view object (no allocation per paint) at the dpr transform.
    const view = state.graphView;
    view.width = width;
    view.height = canvas.h;
    view.selected = row;
    view.leadPx = lead;
    canvas.g.setTransform(canvas.dpr, 0, 0, canvas.dpr, 0, 0);
    graph.paint(canvas.g, window, view, state.graph);
    // Remember what was painted, for the next skip test.
    painted.version = window.version;
    painted.row = row;
    painted.w = width;
    painted.h = canvas.h;
    painted.dpr = canvas.dpr;
    // The fixed canvas over the well, in the same visit; then slide the fresh plot over the next
    // tick (compositor only; the next paint resets it). The fixed canvas stays.
    paintFixed(state, graph, window, canvas);
    startSlide(state, canvas.element, lead);
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
    // The GPU headline: the window's p50 / p90 (spec 03 delta item 8), the mean from an agent
    // before it.
    const before = window.gpuP50Ms === undefined;
    facts.gpuAvg = before ? (meanGpu(window) ?? undefined) : undefined;
    facts.gpuP50 = finiteMs(window.gpuP50Ms);
    facts.gpuP90 = finiteMs(window.gpuP90Ms);
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
 * Paints the graph when it shows: reads the dpr and whether the graph may slide, then hands the
 * paint visitor to `perf.readWindow` once (it sizes the backing store, paints and starts the
 * slide). No layout read.
 *
 * @param octx - Domain context.
 */
export function paintGraphNow(octx: OverlayCtx): void {
  const canvas = octx.state.canvas;
  if (canvas === undefined) return;

  canvas.nextDpr = pixelRatio();
  canvas.motion = slideAllowed(octx.state, octx.registry);
  octx.perf.readWindow(octx.visitors.paint);
}

/**
 * The plot canvas ref of the graph well: mounts the canvas (its context, a size from the design
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
  state.canvas = { element, g, w: size.w, h: size.h, dpr: 0, nextDpr: 1, motion: false };
  state.graph = undefined;
  state.painted.version = -1;
  observeCanvas(state, element);
}

/**
 * The fixed canvas ref of the graph well: mounts the canvas laid over the whole well (its context)
 * or drops it with its painter state. The next tick paints it.
 *
 * @param octx - Domain context.
 * @param element - The canvas, or null when it unmounted.
 */
export function mountFixed(octx: OverlayCtx, element: HTMLCanvasElement | null): void {
  const { state } = octx;
  if (element === null) {
    dropFixed(state);
    return;
  }
  if (state.fixed?.element === element) return;

  const g = octx.graph.context(element);
  if (g === undefined) return;
  state.fixed = { element, g, w: 0, h: 0, dpr: 0 };
  state.fixedGraph = undefined;
  state.painted.version = -1;
}

/**
 * Drops the fixed canvas and its painter state.
 *
 * @param state - Overlay state.
 */
function dropFixed(state: OverlayState): void {
  state.fixed = undefined;
  state.fixedGraph = undefined;
}

/**
 * True for a box the layout has not measured yet (a canvas not shown, or detached).
 *
 * @param box - The observed content box.
 * @param box.width - CSS px.
 * @param box.height - CSS px.
 * @returns Whether it has no area.
 * @example
 * ```ts
 * isUnmeasured({ width: 0, height: 108 }); // true
 * ```
 */
function isUnmeasured(box: { readonly width: number; readonly height: number }): boolean {
  return box.width === 0 || box.height === 0;
}

/**
 * Follows the well's CSS size (the canvas's parent: the canvas itself is painted wider by the
 * slide) with a ResizeObserver (none in a test runtime without one).
 *
 * @param state - Overlay state.
 * @param element - The canvas.
 */
function observeCanvas(state: OverlayState, element: HTMLCanvasElement): void {
  if (typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(entries => {
    const box = entries[0]?.contentRect;
    const canvas = state.canvas;
    if (box === undefined || canvas === undefined || isUnmeasured(box)) return;
    canvas.w = box.width;
    canvas.h = box.height;
  });
  observer.observe(element.parentElement ?? element);
  canvasObservers.set(state, observer);
}

/** The observer of each state's canvas, disconnected with the canvas. */
const canvasObservers = new WeakMap<OverlayState, ResizeObserver>();

/**
 * Drops both canvases and their painter states (the record, another tab, the pill, hidden).
 *
 * @param state - Overlay state.
 */
export function dropCanvas(state: OverlayState): void {
  canvasObservers.get(state)?.disconnect();
  canvasObservers.delete(state);
  state.canvas = undefined;
  state.graph = undefined;
  state.painted.version = -1;
  dropFixed(state);
}
