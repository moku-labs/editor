/**
 * @file renderView device strip — the drawing of the strip's canvas on the tools page (spec 09
 * Amendment 2026-10-15): a requestAnimationFrame loop with a moving now (the newest row's end plus
 * the time since its window arrived, at most one read past it), over a static base layer drawn into
 * an offscreen canvas only on a size, theme or scale change; only while Render shows, the tab is
 * visible and windows arrive (2 s without one: it stops at its last frame); reduced motion keeps
 * the 4 Hz steps. The graph follows the editor's light or dark theme (perf/graph's palettes) and
 * repaints on a switch. The caller-owned canvas: the backing store is sized `width × dpr` by
 * `height × dpr` only when the CSS size or the dpr changed, and the dpr transform is set before
 * every paint. The loop lives with the mounted canvas: its cleanup stops it.
 */
import { workspacePlugin } from "../../workspace";
import type { RenderViewCtx } from "../types";
import type { GraphContext2D, GraphState, GraphTheme } from "./contract";
import { graphLook, paintGraph, resetGraphText, rowAt, spikeAt } from "./contract";
import { notifyStrip } from "./state";
import { selectedRow } from "./step";
import type { DeviceStripState } from "./types";
import { openSpike, selectFrame } from "./watch";

/**
 * One window read, ms: the supervisor's period (the 4 Hz steps of reduced motion) and how far the
 * moving now may run past the newest row (spec 09 Amendment 2026-10-15).
 */
export const REPAINT_MS = 250;

/**
 * "seen N s ago" and the REC clock re-render once a second while the strip is shown.
 */
export const RECORD_TICK_MS = 1000;

/**
 * Without a new window for this long the session is not live: the loop stops at its last frame.
 */
export const STALE_AFTER_MS = 2000;

/**
 * The font the canvas waits for before it measures its legends again: the editor's Geist.
 */
const GRAPH_FONT = '600 11px "Geist"';

/**
 * The media query of reduced motion: the strip keeps the 4 Hz steps.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The largest device pixel ratio the backing store follows.
 */
const MAX_DPR = 3;

/**
 * The 2D context of the strip's canvas: what the painter calls, the dpr transform, and the blit of
 * the static base layer.
 */
export type StripContext = GraphContext2D & {
  setTransform(
    scaleX: number,
    skewY: number,
    skewX: number,
    scaleY: number,
    moveX: number,
    moveY: number
  ): void;
  drawImage(image: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number): void;
};

/**
 * The canvas as the loop uses it: its CSS box, its backing store and its 2D context.
 */
export type StripCanvas = {
  width: number;
  height: number;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
  getContext(kind: "2d"): StripContext | null;
};

/**
 * Makes the offscreen canvas of the static base layer; undefined where there is none.
 */
export type LayerFactory = () => HTMLCanvasElement | undefined;

/**
 * The painter of a mounted canvas: the window version it painted last and a paint now.
 */
type Painter = { version: number; readonly paint: () => void };

/**
 * The size, scale and theme the base layer was drawn for.
 */
type LayerKey = { width: number; height: number; dpr: number; theme: GraphTheme | undefined };

/**
 * What one mounted canvas paints with: its context, the painter state, the base layer and its key,
 * the backing store's size and the theme.
 */
type Surface = {
  readonly canvas: StripCanvas;
  readonly g: StripContext;
  readonly graph: GraphState;
  readonly layer: HTMLCanvasElement | undefined;
  readonly layerG: StripContext | undefined;
  readonly layerKey: LayerKey;
  readonly size: { width: number; height: number; dpr: number };
  theme: GraphTheme;
};

/**
 * The painter of each mounted canvas, by its painter state (dropped with the canvas).
 */
const painters = new WeakMap<GraphState, Painter>();

/**
 * Does nothing: the cleanup of a canvas that never started, and the fonts' failure path.
 */
function stopNothing(): void {}

/**
 * The pixel ratio of the page, clamped to 1…3.
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
 * Whether the person asked for reduced motion.
 *
 * @returns True when `prefers-reduced-motion: reduce` matches.
 */
function isReducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION).matches === true;
}

/**
 * Whether the page's tab is shown.
 *
 * @returns False only when the document says it is hidden.
 */
function isTabVisible(): boolean {
  return globalThis.document?.visibilityState !== "hidden";
}

/**
 * The offscreen canvas of the base layer in a browser.
 *
 * @returns A new canvas; undefined outside a document.
 */
function documentLayer(): HTMLCanvasElement | undefined {
  return globalThis.document?.createElement("canvas");
}

/**
 * The graph theme of the editor's theme.
 *
 * @param ctx - Domain context of renderView.
 * @returns "light" or "dark".
 */
function editorTheme(ctx: RenderViewCtx): GraphTheme {
  return ctx.require(workspacePlugin).theme() === "dark" ? "dark" : "light";
}

/**
 * The moving now: the newest row's end plus the time since its window arrived, never more than one
 * read past it (spec 09 Amendment 2026-10-15).
 *
 * @param strip - The strip state.
 * @returns Page-clock ms of the plot's right edge.
 */
export function movingNow(strip: DeviceStripState): number {
  const { endMs } = strip.window;
  if (strip.windowAt === undefined) return endMs;
  return endMs + Math.min(REPAINT_MS, Math.max(0, performance.now() - strip.windowAt));
}

/**
 * Draws the static base layer (the well, the grid, the tape's body) into the offscreen canvas when
 * the size, the scale or the theme changed since it was drawn.
 *
 * @param surface - The canvas's surface.
 * @param strip - The strip state.
 * @param width - CSS px.
 * @param height - CSS px.
 */
function drawBase(surface: Surface, strip: DeviceStripState, width: number, height: number): void {
  const { layer, layerG, layerKey, size, theme } = surface;
  if (layer === undefined || layerG === undefined) return;
  const same =
    layerKey.width === width &&
    layerKey.height === height &&
    layerKey.dpr === size.dpr &&
    layerKey.theme === theme;
  if (same) return;
  layer.width = Math.round(width * size.dpr);
  layer.height = Math.round(height * size.dpr);
  layerG.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  const look = graphLook(theme);
  paintGraph(
    layerG,
    strip.window,
    { width, height, wide: true, selected: -1, layer: "base", look },
    surface.graph
  );
  layerKey.width = width;
  layerKey.height = height;
  layerKey.dpr = size.dpr;
  layerKey.theme = theme;
}

/**
 * Paints one frame: sizes the backing store when the CSS size or the dpr changed, sets the dpr
 * transform, blits the base layer (redrawn only when stale) and paints the moving part over it;
 * without a base layer the whole graph. Records the window version painted.
 *
 * @param surface - The canvas's surface.
 * @param strip - The strip state.
 * @param painter - The canvas's painter.
 * @param nowMs - The right edge's time; undefined for a step at the newest row.
 */
function drawFrame(
  surface: Surface,
  strip: DeviceStripState,
  painter: Painter,
  nowMs: number | undefined
): void {
  const { canvas, g, size } = surface;
  const box = canvas.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const dpr = pixelRatio();
  if (box.width !== size.width || box.height !== size.height || dpr !== size.dpr) {
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    size.width = box.width;
    size.height = box.height;
    size.dpr = dpr;
  }
  strip.dirty = false;
  drawBase(surface, strip, box.width, box.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const selected = selectedRow(strip.window, strip.selected);
  const look = graphLook(surface.theme);
  const view = { width: box.width, height: box.height, wide: true, selected, look };
  if (surface.layer === undefined) {
    paintGraph(g, strip.window, nowMs === undefined ? view : { ...view, nowMs }, surface.graph);
  } else {
    g.drawImage(surface.layer, 0, 0, box.width, box.height);
    const over = { ...view, layer: "over" as const };
    paintGraph(g, strip.window, nowMs === undefined ? over : { ...over, nowMs }, surface.graph);
  }
  painter.version = strip.window.version;
}

/**
 * Measures the legends again once Geist has loaded, and once more when every font is ready: the
 * painter's cached text is reset and a strip with data repaints.
 *
 * @param strip - The strip state.
 * @param graph - The painter state of the canvas.
 */
function watchFonts(strip: DeviceStripState, graph: GraphState): void {
  const fonts = globalThis.document?.fonts;
  if (fonts === undefined) return;
  const refont = (): void => {
    resetGraphText(graph);
    if (strip.window.count > 0) strip.dirty = true;
  };
  fonts.load(GRAPH_FONT).then(refont, stopNothing);
  fonts.ready.then(refont, stopNothing);
}

/**
 * Makes the surface of a mounted canvas: its context, an offscreen base layer when the page can
 * make one, and the editor's theme now.
 *
 * @param ctx - Domain context of renderView.
 * @param canvas - The strip's canvas.
 * @param g - Its context.
 * @param graph - The painter state made with the canvas.
 * @param makeLayer - Makes the offscreen canvas.
 * @returns The surface.
 */
function makeSurface(
  ctx: RenderViewCtx,
  canvas: StripCanvas,
  g: StripContext,
  graph: GraphState,
  makeLayer: LayerFactory
): Surface {
  const layer = makeLayer();
  const layerG = layer?.getContext("2d") ?? undefined;
  return {
    canvas,
    g,
    graph,
    layer: layerG === undefined ? undefined : layer,
    layerG,
    layerKey: { width: 0, height: 0, dpr: 0, theme: undefined },
    size: { width: 0, height: 0, dpr: 0 },
    theme: editorTheme(ctx)
  };
}

/**
 * Starts the drawing of a mounted strip canvas (spec 09 Amendment 2026-10-15): a
 * requestAnimationFrame loop with a moving now while Render shows, the tab is visible and windows
 * arrive (it stops at its last frame 2 s after the last one); reduced motion paints 4 Hz steps
 * instead. A supervisor every `REPAINT_MS` starts the loop again, a second interval re-renders the
 * strip's clocks once a second; the editor's theme switch repaints with the other palette; the fonts
 * reset the painter's measured legends when they load.
 *
 * @param ctx - Domain context of renderView.
 * @param canvas - The strip's canvas; null before it mounted.
 * @param graph - The painter state made with the canvas.
 * @param makeLayer - Makes the offscreen canvas of the base layer (a document canvas by default).
 * @returns The cleanup: stops the loop and both intervals, drops the theme listener (idempotent).
 */
export function startRepaint(
  ctx: RenderViewCtx,
  canvas: StripCanvas | null,
  graph: GraphState,
  makeLayer: LayerFactory = documentLayer
): () => void {
  const { state } = ctx;
  const strip = state.device;
  const g = canvas?.getContext("2d");
  if (canvas === null || g === null || g === undefined) return stopNothing;

  // A re-mounted canvas is blank: paint the data the strip holds at the next tick.
  if (strip.window.count > 0) strip.dirty = true;
  const surface = makeSurface(ctx, canvas, g, graph, makeLayer);
  const painter: Painter = { version: -1, paint: () => paintStill() };
  const loop: { handle: number | undefined } = { handle: undefined };
  painters.set(graph, painter);
  watchFonts(strip, graph);

  const isLive = (): boolean =>
    strip.windowAt !== undefined && performance.now() - strip.windowAt <= STALE_AFTER_MS;
  const shouldRun = (): boolean => state.active && isTabVisible() && !isReducedMotion() && isLive();
  const paintStill = (): void => {
    drawFrame(surface, strip, painter, isReducedMotion() ? undefined : movingNow(strip));
  };
  const frame = (): void => {
    loop.handle = undefined;
    if (!shouldRun()) return;
    drawFrame(surface, strip, painter, movingNow(strip));
    loop.handle = requestAnimationFrame(frame);
  };
  const supervise = (): void => {
    if (!state.active || !isTabVisible()) return;
    if (shouldRun()) {
      loop.handle ??= requestAnimationFrame(frame);
      return;
    }
    if (strip.dirty) paintStill();
  };
  const offTheme = ctx.require(workspacePlugin).onPrefs(() => {
    const theme = editorTheme(ctx);
    if (theme === surface.theme) return;
    surface.theme = theme;
    if (loop.handle === undefined && state.active) paintStill();
  });

  const supervisor = setInterval(supervise, REPAINT_MS);
  // "seen N s ago" and the REC clock: only the strip re-renders, not the Render workspace.
  const tick = setInterval(() => {
    if (state.active) notifyStrip(strip);
  }, RECORD_TICK_MS);
  const stop = (): void => {
    clearInterval(supervisor);
    clearInterval(tick);
    if (loop.handle !== undefined) cancelAnimationFrame(loop.handle);
    loop.handle = undefined;
    offTheme();
    if (painters.get(graph) === painter) painters.delete(graph);
    if (strip.stopPaint === stop) strip.stopPaint = undefined;
  };
  strip.stopPaint?.();
  strip.stopPaint = stop;
  return stop;
}

/**
 * A click on the strip's graph at CSS px `(x, y)`: on a spike's flag or bar it selects that frame
 * and opens its record; elsewhere it selects the frame under the pointer (the readout box moves)
 * and leaves the record panel as it is. When a value arrived after the last paint (the window
 * was refilled, its rows moved), the canvas is painted first, so the hit boxes are the ones of
 * the graph the person sees.
 *
 * @param ctx - Domain context of renderView.
 * @param graph - The painter state of the last paint.
 * @param x - CSS px from the canvas's left.
 * @param y - CSS px from its top.
 */
export function clickGraph(ctx: RenderViewCtx, graph: GraphState, x: number, y: number): void {
  const strip = ctx.state.device;
  const { window } = strip;
  const painter = painters.get(graph);
  if (painter !== undefined && (strip.dirty || painter.version !== window.version)) painter.paint();
  const spike = spikeAt(graph, window, x, y);
  if (spike >= 0) {
    void openSpike(ctx, window.frame[spike] ?? 0);
    return;
  }
  const row = rowAt(graph, window, x);
  if (row >= 0) selectFrame(ctx, window.frame[row] ?? 0);
}
