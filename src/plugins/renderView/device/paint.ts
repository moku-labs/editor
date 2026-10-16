/**
 * @file renderView device strip — the drawing of the strip's canvas on the tools page (spec 09
 * Amendments 2026-10-15 and 2026-10-16): a requestAnimationFrame loop with a moving now, the
 * playout clock that runs at real time a measured delay behind the newest row (`playout.ts`), over a
 * static base layer drawn into an offscreen canvas only on a size, theme or scale change; only while
 * Render shows, the tab is visible and windows arrive (2 s without one: it stops at its last frame);
 * reduced motion keeps the 4 Hz steps at the newest row. The graph follows the editor's light or
 * dark theme (perf/graph's palettes) and repaints on a switch. The caller-owned canvas: the backing
 * store is sized `width × dpr` by `height × dpr` only when the CSS size or the dpr changed, and the
 * dpr transform is set before every paint. The loop lives with the mounted canvas: its cleanup
 * stops it.
 */
import { workspacePlugin } from "../../workspace";
import type { RenderViewCtx } from "../types";
import type { GraphContext2D, GraphLayer, GraphLook, GraphState, GraphTheme } from "./contract";
import { graphLook, paintGraph, resetGraphText, rowAt, spikeAt } from "./contract";
import { playoutSpan, resetPlayout, stepPlayout } from "./playout";
import { notifyStrip } from "./state";
import { selectedRow } from "./step";
import type { DeviceStripState } from "./types";
import { openSpike, selectFrame } from "./watch";

/**
 * One window read, ms: the supervisor's period and the 4 Hz steps of reduced motion (spec 09
 * Amendment 2026-10-15).
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
 * A view the loop paints with, changed in place every frame: a frame allocates no view (review W4).
 */
type FrameView = {
  width: number;
  height: number;
  readonly wide: true;
  selected: number;
  look: GraphLook;
  readonly layer: GraphLayer;
};

/**
 * The view of a frame with a moving now: the right edge's time and the time the plot spans.
 */
type MovingView = FrameView & { nowMs: number; spanMs: number };

/**
 * What one mounted canvas paints with: its context, the painter state, the base layer and its key,
 * the canvas's CSS box (read once at mount, then from a ResizeObserver: a frame reads no layout),
 * the backing store's size, the theme and the three views it paints with.
 */
type Surface = {
  readonly canvas: StripCanvas;
  readonly g: StripContext;
  readonly graph: GraphState;
  readonly layer: HTMLCanvasElement | undefined;
  readonly layerG: StripContext | undefined;
  readonly layerKey: LayerKey;
  readonly box: { width: number; height: number };
  readonly size: { width: number; height: number; dpr: number };
  theme: GraphTheme;
  /** The 4 Hz step: the newest row at the right edge. */
  readonly still: FrameView;
  /** The interpolated frame. */
  readonly moving: MovingView;
  /** The static base layer. */
  readonly base: FrameView;
};

/**
 * Whether the person asked for reduced motion, kept from one media query and its change events.
 */
type Motion = { reduced: boolean; readonly stop: () => void };

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
 * Asks `prefers-reduced-motion: reduce` once and follows its change events: a frame reads the kept
 * answer, it never asks the media query (review W4).
 *
 * @returns The answer and the cleanup that drops the listener.
 */
function watchMotion(): Motion {
  const query = globalThis.matchMedia?.(REDUCED_MOTION);
  if (query === undefined) return { reduced: false, stop: stopNothing };
  const onChange = (): void => {
    motion.reduced = query.matches;
  };
  const motion: Motion = {
    reduced: query.matches,
    stop: () => query.removeEventListener?.("change", onChange)
  };
  query.addEventListener?.("change", onChange);
  return motion;
}

/**
 * Follows the canvas's CSS box with a ResizeObserver (the border box, as a click measures it); a
 * new box makes a strip with data repaint. Without a ResizeObserver (or for a canvas that is no
 * element) the box stays as read at mount.
 *
 * @param surface - The canvas's surface.
 * @param strip - The strip state.
 * @returns The cleanup that disconnects the observer.
 */
function watchSize(surface: Surface, strip: DeviceStripState): () => void {
  const { canvas, box } = surface;
  const { ResizeObserver: Observer, Element: Base } = globalThis;
  if (Observer === undefined || Base === undefined || !(canvas instanceof Base)) return stopNothing;
  const observer = new Observer(entries => {
    const entry = entries.at(-1);
    if (entry === undefined) return;
    const border = entry.borderBoxSize?.[0];
    box.width = border?.inlineSize ?? entry.contentRect.width;
    box.height = border?.blockSize ?? entry.contentRect.height;
    if (strip.window.count > 0) strip.dirty = true;
  });
  observer.observe(canvas);
  return () => observer.disconnect();
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
 * The moving now: the strip's playout clock stepped to this frame, a measured delay behind the
 * newest row and never past it (spec 09 Amendment 2026-10-16); the newest row's end before a window
 * arrived.
 *
 * @param strip - The strip state.
 * @returns Page-clock ms of the plot's right edge.
 */
export function movingNow(strip: DeviceStripState): number {
  const { endMs } = strip.window;
  if (strip.windowAt === undefined) return endMs;
  return stepPlayout(strip.playout, endMs, strip.windowAt, performance.now());
}

/**
 * Draws the static base layer (the well, the grid, the tape's body) into the offscreen canvas when
 * the size, the scale or the theme changed since it was drawn.
 *
 * @param surface - The canvas's surface.
 * @param strip - The strip state.
 * @param look - The look of the theme.
 */
function drawBase(surface: Surface, strip: DeviceStripState, look: GraphLook): void {
  const { layer, layerG, layerKey, size, theme, base } = surface;
  if (layer === undefined || layerG === undefined) return;
  const same =
    layerKey.width === size.width &&
    layerKey.height === size.height &&
    layerKey.dpr === size.dpr &&
    layerKey.theme === theme;
  if (same) return;
  layer.width = Math.round(size.width * size.dpr);
  layer.height = Math.round(size.height * size.dpr);
  layerG.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  base.width = size.width;
  base.height = size.height;
  base.look = look;
  paintGraph(layerG, strip.window, base, surface.graph);
  layerKey.width = size.width;
  layerKey.height = size.height;
  layerKey.dpr = size.dpr;
  layerKey.theme = theme;
}

/**
 * Paints one frame: sizes the backing store when the CSS size or the dpr changed, sets the dpr
 * transform, blits the base layer (redrawn only when stale) and paints the moving part over it;
 * without a base layer the whole graph. A moving frame steps the playout clock and spans the window
 * less its cut; a step paints the whole window at the newest row. Records the window version
 * painted.
 *
 * @param surface - The canvas's surface.
 * @param strip - The strip state.
 * @param painter - The canvas's painter.
 * @param moving - At the playout clock (the loop); false for a 4 Hz step at the newest row.
 */
function drawFrame(
  surface: Surface,
  strip: DeviceStripState,
  painter: Painter,
  moving: boolean
): void {
  const { canvas, g, box, size } = surface;
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
  const look = graphLook(surface.theme);
  drawBase(surface, strip, look);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let view: FrameView = surface.still;
  if (moving) {
    const { window } = strip;
    surface.moving.nowMs = movingNow(strip);
    surface.moving.spanMs = playoutSpan(strip.playout, window.endMs - window.startMs);
    view = surface.moving;
  }
  view.width = size.width;
  view.height = size.height;
  view.selected = selectedRow(strip.window, strip.selected);
  view.look = look;
  if (surface.layer !== undefined) g.drawImage(surface.layer, 0, 0, size.width, size.height);
  paintGraph(g, strip.window, view, surface.graph);
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
 * make one, its CSS box (the one layout read, at mount), the editor's theme now and its views.
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
  const made = makeLayer();
  const layerG = made?.getContext("2d") ?? undefined;
  const layer = layerG === undefined ? undefined : made;
  const { width, height } = canvas.getBoundingClientRect();
  const theme = editorTheme(ctx);
  const look = graphLook(theme);
  // With a base layer each frame paints the moving part over it; without one, all of it.
  const paints: GraphLayer = layer === undefined ? "all" : "over";
  const viewOf = (kind: GraphLayer): FrameView => ({
    width: 0,
    height: 0,
    wide: true,
    selected: -1,
    look,
    layer: kind
  });
  return {
    canvas,
    g,
    graph,
    layer,
    layerG,
    layerKey: { width: 0, height: 0, dpr: 0, theme: undefined },
    box: { width, height },
    size: { width: 0, height: 0, dpr: 0 },
    theme,
    still: viewOf(paints),
    moving: { ...viewOf(paints), nowMs: 0, spanMs: 0 },
    base: viewOf("base")
  };
}

/**
 * Starts the drawing of a mounted strip canvas (spec 09 Amendments 2026-10-15 and 2026-10-16): a
 * requestAnimationFrame loop at the playout clock while Render shows, the tab is visible and windows
 * arrive (it stops at its last frame 2 s after the last one); reduced motion paints 4 Hz steps at
 * the newest row instead. A supervisor every `REPAINT_MS` starts the loop again, a second interval re-renders the
 * strip's clocks once a second; the editor's theme switch repaints with the other palette; the fonts
 * reset the painter's measured legends when they load.
 *
 * @param ctx - Domain context of renderView.
 * @param canvas - The strip's canvas; null before it mounted.
 * @param graph - The painter state made with the canvas.
 * @param makeLayer - Makes the offscreen canvas of the base layer (a document canvas by default).
 * @returns The cleanup: stops the loop and both intervals, drops the theme and motion listeners and
 * the size observer, starts the playout clock over (idempotent).
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
  const motion = watchMotion();
  const stopSize = watchSize(surface, strip);

  const isLive = (): boolean =>
    strip.windowAt !== undefined && performance.now() - strip.windowAt <= STALE_AFTER_MS;
  const shouldRun = (): boolean => state.active && isTabVisible() && !motion.reduced && isLive();
  const paintStill = (): void => {
    drawFrame(surface, strip, painter, !motion.reduced);
  };
  const frame = (): void => {
    loop.handle = undefined;
    if (!shouldRun()) return;
    drawFrame(surface, strip, painter, true);
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
    motion.stop();
    stopSize();
    if (painters.get(graph) === painter) painters.delete(graph);
    // Only the canvas that draws now starts the clock over: a late second stop of an old one does not.
    if (strip.stopPaint !== stop) return;
    strip.stopPaint = undefined;
    resetPlayout(strip.playout);
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
