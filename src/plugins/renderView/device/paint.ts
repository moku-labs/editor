/**
 * @file renderView device strip — the repaint loop of the strip's canvas (spec 09 § Config,
 * design §2 Motion, §9 non-negotiable 1): at most one paint every `REPAINT_MS` and only after a
 * value arrived (or the selection moved), nothing while Render is hidden, through the painter of
 * `perf/graph`. The caller-owned canvas: the backing store is sized `width × dpr` by
 * `height × dpr` only when the CSS size or the dpr changed, and the dpr transform is set before
 * every paint. A second interval re-renders "seen N s ago" and the REC clock once a second. The
 * loop lives with the mounted canvas: its cleanup clears both intervals.
 */
import { notify } from "../state";
import type { RenderViewCtx } from "../types";
import type { GraphContext2D, GraphState } from "./contract";
import { paintGraph, resetGraphText, rowAt, spikeAt } from "./contract";
import { selectedRow } from "./step";
import { openSpike, selectFrame } from "./watch";

/**
 * The graph repaints at most 4 times a second (design §2 Motion, §9).
 */
export const REPAINT_MS = 250;

/**
 * "seen N s ago" and the REC clock re-render once a second while the strip is shown.
 */
export const RECORD_TICK_MS = 1000;

/**
 * The font the canvas waits for before it paints legends.
 */
const GRAPH_FONT = '600 12px "Barlow Condensed"';

/**
 * The largest device pixel ratio the backing store follows.
 */
const MAX_DPR = 3;

/**
 * The canvas as the loop uses it: its CSS box, its backing store and its 2D context.
 */
export type StripCanvas = {
  width: number;
  height: number;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
  getContext(kind: "2d"):
    | (GraphContext2D & {
        setTransform(
          scaleX: number,
          skewY: number,
          skewX: number,
          scaleY: number,
          moveX: number,
          moveY: number
        ): void;
      })
    | null;
};

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
 * Starts the repaint loop of a mounted strip canvas; the fonts reset the painter's measured
 * legends when they load.
 *
 * @param ctx - Domain context of renderView.
 * @param canvas - The strip's canvas; null before it mounted.
 * @param graph - The painter state made with the canvas.
 * @returns The cleanup: clears both intervals (idempotent).
 */
export function startRepaint(
  ctx: RenderViewCtx,
  canvas: StripCanvas | null,
  graph: GraphState
): () => void {
  const { state } = ctx;
  const strip = state.device;
  const g = canvas?.getContext("2d");
  if (canvas === null || g === null || g === undefined) return stopNothing;

  let size = { width: 0, height: 0, dpr: 0 };
  // A re-mounted canvas is blank: paint the data the strip holds at the next tick.
  if (strip.window.count > 0) strip.dirty = true;

  const paint = (): void => {
    if (!state.active || !strip.dirty) return;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const dpr = pixelRatio();
    if (box.width !== size.width || box.height !== size.height || dpr !== size.dpr) {
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      size = { width: box.width, height: box.height, dpr };
    }
    strip.dirty = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = {
      width: box.width,
      height: box.height,
      wide: true,
      selected: selectedRow(strip.window, strip.selected)
    };
    paintGraph(g, strip.window, view, graph);
  };
  const refont = (): void => {
    resetGraphText(graph);
    if (strip.window.count > 0) strip.dirty = true;
  };
  const fonts = globalThis.document?.fonts;
  if (fonts !== undefined) {
    fonts.load(GRAPH_FONT).then(refont, stopNothing);
    fonts.ready.then(refont, stopNothing);
  }

  const repaint = setInterval(paint, REPAINT_MS);
  const tick = setInterval(() => {
    if (state.active) notify(state);
  }, RECORD_TICK_MS);
  const stop = (): void => {
    clearInterval(repaint);
    clearInterval(tick);
    if (strip.stopPaint === stop) strip.stopPaint = undefined;
  };
  strip.stopPaint?.();
  strip.stopPaint = stop;
  return stop;
}

/**
 * A click on the strip's graph at CSS px `(x, y)`: on a spike's flag or bar it selects that frame
 * and opens its record; elsewhere it selects the frame under the pointer (the readout box moves)
 * and leaves the record panel as it is.
 *
 * @param ctx - Domain context of renderView.
 * @param graph - The painter state of the last paint.
 * @param x - CSS px from the canvas's left.
 * @param y - CSS px from its top.
 */
export function clickGraph(ctx: RenderViewCtx, graph: GraphState, x: number, y: number): void {
  const { window } = ctx.state.device;
  const spike = spikeAt(graph, window, x, y);
  if (spike >= 0) {
    void openSpike(ctx, window.frame[spike] ?? 0);
    return;
  }
  const row = rowAt(graph, window, x);
  if (row >= 0) selectFrame(ctx, window.frame[row] ?? 0);
}
