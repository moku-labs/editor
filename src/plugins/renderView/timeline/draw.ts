/**
 * @file renderView timeline — the drawing primitives every painter shares (spec 09 § M8): dashes,
 * lines, rounded boxes, chips with text, diamonds and triangles, and the three overlays the timeline
 * and the lane draw the same way (the selection, the source-switch marker, the cursor). Every call
 * draws with what it is given and allocates nothing: the dash patterns are module arrays (the
 * context copies them) and every string comes from the label caches.
 */
import { rowOfFrame } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import type { FrameRange } from "../view/types";
import type { FontId } from "./labels";
import { FONTS, widthOf } from "./labels";
import type { PaintContext, TimelineLayout } from "./layout";
import { plotBottom, xOf } from "./layout";
import type { PaintScene } from "./scene";

/** The names of the dash patterns. */
type DashName =
  | "none"
  | "budget"
  | "gc"
  | "leader"
  | "record"
  | "rate"
  | "marker"
  | "reference"
  | "trend";

/** The dash patterns of spec 09 § M8 and M9, one array each (setLineDash copies it). */
export const DASH: Readonly<Record<DashName, number[]>> = {
  none: [],
  budget: [4, 3],
  gc: [2, 3],
  leader: [2, 2],
  record: [3, 3],
  rate: [5, 3],
  marker: [4, 3],
  reference: [3, 3],
  trend: [4, 3]
};

/**
 * A vertical line.
 *
 * @param g - The context.
 * @param x - CSS px.
 * @param top - Its top.
 * @param bottom - Its bottom.
 */
export function vline(g: PaintContext, x: number, top: number, bottom: number): void {
  g.beginPath();
  g.moveTo(x, top);
  g.lineTo(x, bottom);
  g.stroke();
}

/**
 * A horizontal line.
 *
 * @param g - The context.
 * @param y - CSS px.
 * @param left - Its left end.
 * @param right - Its right end.
 */
export function hline(g: PaintContext, y: number, left: number, right: number): void {
  g.beginPath();
  g.moveTo(left, y);
  g.lineTo(right, y);
  g.stroke();
}

/**
 * The path of a rounded box.
 *
 * @param g - The context.
 * @param x - Left.
 * @param y - Top.
 * @param w - Width.
 * @param h - Height.
 * @param r - Corner radius.
 */
export function roundBox(
  g: PaintContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

/**
 * A diamond centred on a point.
 *
 * @param g - The context.
 * @param x - Centre x.
 * @param y - Centre y.
 * @param r - Half its diagonal.
 * @param hollow - Stroke its outline only (an inferred GC).
 */
export function diamond(g: PaintContext, x: number, y: number, r: number, hollow: boolean): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  if (hollow) g.stroke();
  else g.fill();
}

/**
 * A triangle pointing down, its apex at the bottom.
 *
 * @param g - The context.
 * @param x - Centre x.
 * @param top - The top edge.
 * @param w - Its width.
 * @param h - Its height.
 */
export function triangleDown(g: PaintContext, x: number, top: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(x - w / 2, top);
  g.lineTo(x + w / 2, top);
  g.lineTo(x, top + h);
  g.closePath();
  g.fill();
}

/** How a chip is drawn: ground, tint (and its alpha) for the layer and border, text, font, shape. */
export type ChipStyle = {
  readonly ground: string;
  readonly tint: string;
  readonly tintAlpha: number;
  readonly text: string;
  readonly font: FontId;
  readonly radius: number;
  readonly height: number;
};

/**
 * The width of a chip with its text and 6 px padding on each side.
 *
 * @param g - The context.
 * @param scene - The scene (its width cache).
 * @param font - The chip's font.
 * @param text - Its text.
 * @returns CSS px.
 */
export function chipWidth(g: PaintContext, scene: PaintScene, font: FontId, text: string): number {
  g.font = FONTS[font];
  return widthOf(scene.labels, g, font, text) + 12;
}

/**
 * A chip: the ground, the tint at its alpha with a 1 px border in the tint, the text at `x + 6`.
 *
 * @param g - The context.
 * @param style - The chip's colours, font and shape.
 * @param text - Its text.
 * @param box - Its left, top and width.
 * @param box.x - Left.
 * @param box.y - Top.
 * @param box.w - Width.
 */
export function chip(
  g: PaintContext,
  style: ChipStyle,
  text: string,
  box: { readonly x: number; readonly y: number; readonly w: number }
): void {
  roundBox(g, box.x, box.y, box.w, style.height, style.radius);
  g.fillStyle = style.ground;
  g.fill();
  g.globalAlpha = style.tintAlpha;
  g.fillStyle = style.tint;
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = style.tint;
  g.lineWidth = 1;
  g.setLineDash(DASH.none);
  g.stroke();
  g.font = FONTS[style.font];
  g.fillStyle = style.text;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(text, box.x + 6, box.y + style.height / 2);
}

/** Where a label is drawn: x, the middle of the text, and the alignment. */
export type LabelAt = {
  readonly x: number;
  readonly y: number;
  readonly align: "left" | "center" | "right";
};

/**
 * Text at a point in a font and colour.
 *
 * @param g - The context.
 * @param font - The font.
 * @param colour - The colour.
 * @param text - The text.
 * @param at - Where.
 */
export function label(
  g: PaintContext,
  font: FontId,
  colour: string,
  text: string,
  at: LabelAt
): void {
  g.font = FONTS[font];
  g.fillStyle = colour;
  g.textAlign = at.align;
  g.textBaseline = "middle";
  g.fillText(text, at.x, at.y);
}

/** Where a label goes, one object per module and paint (no allocation). */
const AT: { x: number; y: number; align: LabelAt["align"] } = { x: 0, y: 0, align: "left" };

/**
 * The reused label position.
 *
 * @param x - x.
 * @param y - y.
 * @param align - The alignment.
 * @returns The position (the same object each call: draw before the next call).
 */
export function at(x: number, y: number, align: LabelAt["align"]): LabelAt {
  AT.x = x;
  AT.y = y;
  AT.align = align;
  return AT;
}

/** The x range of the selection of the current paint (one object, reused). */
const SPAN = { left: 0, right: 0 };

/**
 * Writes the x range of selected frames in a view into SPAN.
 *
 * @param history - The history.
 * @param layout - The geometry.
 * @param selection - The selected frames.
 * @param scene - The view's end and span.
 * @returns False when none of them is held.
 */
function selectionSpan(
  history: PerfHistory,
  layout: TimelineLayout,
  selection: FrameRange,
  scene: PaintScene
): boolean {
  const first = rowOfFrame(history, selection.from);
  const last = rowOfFrame(history, selection.to);
  if (first < 0 || last < 0) return false;
  const start = scene.endMs - scene.span;
  SPAN.left = xOf(layout, history.t[first] ?? 0, start, scene.span);
  SPAN.right = xOf(layout, (history.t[last] ?? 0) + (history.ms[last] ?? 0), start, scene.span);
  return true;
}

/**
 * The selection over a plot: everything outside dims (the canvas colour at 55 %), the band in the
 * accent at 14 %, 1.5 px edges and the two handles (6 × 18, radius 3) at mid height.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param selection - The selected frames; undefined for none.
 * @param scene - The scene.
 * @example
 * ```ts
 * paintSelection(g, layout, mission.history, { from: 4810, to: 4860 }, scene); // dims around it
 * ```
 */
export function paintSelection(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  selection: FrameRange | undefined,
  scene: PaintScene
): void {
  if (selection === undefined || !selectionSpan(history, layout, selection, scene)) return;
  const { palette } = scene;
  const bottom = plotBottom(layout) + layout.lane;
  const width = layout.plot.w;
  const left = Math.min(width, Math.max(0, SPAN.left));
  const right = Math.min(width, Math.max(SPAN.right, left + 1));
  g.globalAlpha = 0.55;
  g.fillStyle = palette.canvas;
  g.fillRect(0, 0, left, bottom);
  g.fillRect(right, 0, width - right, bottom);
  g.globalAlpha = 0.14;
  g.fillStyle = palette.accent;
  g.fillRect(left, 0, right - left, bottom);
  g.globalAlpha = 1;
  g.strokeStyle = palette.accent;
  g.lineWidth = 1.5;
  g.setLineDash(DASH.none);
  vline(g, left, 0, bottom);
  vline(g, right, 0, bottom);
  g.fillStyle = palette.accent;
  const handleTop = plotBottom(layout) / 2 - 9;
  roundBox(g, left - 3, handleTop, 6, 18, 3);
  g.fill();
  roundBox(g, right - 3, handleTop, 6, 18, 3);
  g.fill();
}

/**
 * The source-switch marker: a dashed `[4, 3]` line from the top to the lane's bottom; with
 * `labels`, the first part of its label centred over the plot left of it (when wider than 200 px)
 * and the second at `x + 8` (when 150 px are left).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene (its marker).
 * @param labels - Draw the marker's words (the timeline; the lane draws the line only).
 * @example
 * ```ts
 * paintMarker(g, layout, scene, true); // "Galaxy A26 disconnected here" | "Local preview resumed"
 * ```
 */
export function paintMarker(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  labels: boolean
): void {
  if (Number.isNaN(scene.markerT)) return;
  const x = xOf(layout, scene.markerT, scene.endMs - scene.span, scene.span);
  if (x < 0 || x > layout.plot.w) return;
  const { palette } = scene;
  g.strokeStyle = palette.text2;
  g.lineWidth = 1;
  g.setLineDash(DASH.marker);
  vline(g, x, 0, plotBottom(layout) + layout.lane);
  g.setLineDash(DASH.none);
  if (!labels) return;
  const y = layout.plot.y + 8;
  if (x > 200) label(g, "sans500", palette.text2, scene.markerLeft, at(x / 2, y, "center"));
  if (layout.plot.w - x > 150) {
    label(g, "sans500", palette.text2, scene.markerRight, at(x + 8, y, "left"));
  }
}

/**
 * The shared cursor: a 1 px line in the ink at 55 % from the top to the lane's bottom.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param hoverMs - The source time under the pointer; undefined for none.
 * @param scene - The scene.
 * @example
 * ```ts
 * paintCursor(g, layout, 77_000, scene); // a line in the middle of a 6 s view ending at 80 s
 * ```
 */
export function paintCursor(
  g: PaintContext,
  layout: TimelineLayout,
  hoverMs: number | undefined,
  scene: PaintScene
): void {
  if (hoverMs === undefined) return;
  const x = xOf(layout, hoverMs, scene.endMs - scene.span, scene.span);
  if (x < 0 || x > layout.plot.w) return;
  g.globalAlpha = 0.55;
  g.strokeStyle = scene.palette.ink;
  g.lineWidth = 1;
  g.setLineDash(DASH.none);
  vline(g, x, 0, plotBottom(layout) + layout.lane);
  g.globalAlpha = 1;
}
