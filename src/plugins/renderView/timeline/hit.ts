/**
 * @file renderView timeline — hit tests of the timeline, the lane and the overview (spec 09 § M8,
 * M11): the frame under a pointer, a spike flag (its box written by the painter into preallocated
 * typed arrays), and the overview's drag (a press inside the viewport keeps its grab offset,
 * elsewhere the viewport centres on the pointer). Pure.
 */
import { firstVisibleRow, rowAtTime } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import { HISTORY_MS } from "../source/contract";
import type { TimelineLayout } from "./layout";

/** Flags whose boxes a paint keeps. */
export const MAX_FLAGS = 128;

/**
 * The boxes of the flags painted last (x, y, w, h) and the frames each selects, preallocated.
 *
 * @example
 * ```ts
 * const hits: FlagHits = createFlagHits();
 * hits.count; // 0 before a paint
 * ```
 */
export type FlagHits = {
  count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly w: Float32Array;
  readonly h: Float32Array;
  readonly from: Uint32Array;
  readonly to: Uint32Array;
};

/**
 * Makes the flag boxes, empty.
 *
 * @returns The boxes.
 * @example
 * ```ts
 * createFlagHits().x.length; // 128
 * ```
 */
export function createFlagHits(): FlagHits {
  return {
    count: 0,
    x: new Float32Array(MAX_FLAGS),
    y: new Float32Array(MAX_FLAGS),
    w: new Float32Array(MAX_FLAGS),
    h: new Float32Array(MAX_FLAGS),
    from: new Uint32Array(MAX_FLAGS),
    to: new Uint32Array(MAX_FLAGS)
  };
}

/**
 * Keeps one flag's box and frames (the painter calls it; past MAX_FLAGS boxes are dropped).
 *
 * @param hits - The boxes.
 * @param box - x, y, w, h of the flag, CSS px.
 * @param box.x - Left.
 * @param box.y - Top.
 * @param box.w - Width.
 * @param box.h - Height.
 * @param from - The group's first frame.
 * @param to - Its last frame.
 * @example
 * ```ts
 * addFlagHit(hits, { x: 412, y: 5, w: 70, h: 20 }, 4851, 4853);
 * ```
 */
export function addFlagHit(
  hits: FlagHits,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  from: number,
  to: number
): void {
  const index = hits.count;
  if (index >= MAX_FLAGS) return;
  hits.x[index] = box.x;
  hits.y[index] = box.y;
  hits.w[index] = box.w;
  hits.h[index] = box.h;
  hits.from[index] = from;
  hits.to[index] = to;
  hits.count = index + 1;
}

/**
 * The flag under a pointer, the newest painted first.
 *
 * @param hits - The boxes of the last paint.
 * @param x - Pointer x, CSS px.
 * @param y - Pointer y, CSS px.
 * @returns The flag's index; −1 for none.
 * @example
 * ```ts
 * const flag = flagAt(hits, 420, 12);
 * if (flag >= 0) select({ from: hits.from[flag], to: hits.to[flag] });
 * ```
 */
export function flagAt(hits: FlagHits, x: number, y: number): number {
  for (let index = hits.count - 1; index >= 0; index -= 1) {
    const left = hits.x[index] ?? 0;
    const top = hits.y[index] ?? 0;
    if (x < left || x > left + (hits.w[index] ?? 0)) continue;
    if (y >= top && y <= top + (hits.h[index] ?? 0)) return index;
  }
  return -1;
}

/**
 * The frame under a pointer's x: the newest row starting at or before the time there.
 *
 * @param history - The history.
 * @param layout - The canvas's geometry.
 * @param x - Pointer x, CSS px.
 * @param startMs - The view's start, source clock.
 * @param span - The view's span, ms.
 * @returns The frame; undefined outside the plot or over no data.
 * @example
 * ```ts
 * frameAt(history, layout, 455, 74_000, 6000); // 4851
 * ```
 */
export function frameAt(
  history: PerfHistory,
  layout: TimelineLayout,
  x: number,
  startMs: number,
  span: number
): number | undefined {
  const { plot } = layout;
  if (x < plot.x || x > plot.x + plot.w) return undefined;
  const t = startMs + ((x - plot.x) / plot.w) * span;
  const row = Math.max(rowAtTime(history, t), firstVisibleRow(history, startMs));
  if (row < 0 || row >= history.count) return undefined;
  const rowT = history.t[row] ?? 0;
  if (rowT > t || rowT + (history.ms[row] ?? 0) < t - span / plot.w) return undefined;
  return history.frame[row];
}

/**
 * The source-clock time at an x of the overview (the last two minutes before the live end).
 *
 * @param layout - The overview's geometry.
 * @param x - CSS px.
 * @param liveEndMs - The live end.
 * @returns Source-clock ms.
 * @example
 * ```ts
 * overviewTime(layout, 450, 140_000); // 80 000 on a 900 px overview
 * ```
 */
export function overviewTime(layout: TimelineLayout, x: number, liveEndMs: number): number {
  return liveEndMs - HISTORY_MS + ((x - layout.plot.x) / layout.plot.w) * HISTORY_MS;
}

/**
 * The x of a source-clock time on the overview.
 *
 * @param layout - The overview's geometry.
 * @param t - Source-clock ms.
 * @param liveEndMs - The live end.
 * @returns CSS px.
 * @example
 * ```ts
 * overviewX(layout, 80_000, 140_000); // 450 on a 900 px overview
 * ```
 */
export function overviewX(layout: TimelineLayout, t: number, liveEndMs: number): number {
  return layout.plot.x + ((t - (liveEndMs - HISTORY_MS)) / HISTORY_MS) * layout.plot.w;
}

/**
 * What a press on the overview keeps while it drags: the view's end minus the time under the
 * pointer. A press inside the viewport keeps that offset (the viewport moves with the hand);
 * elsewhere the viewport centres on the pointer (half a span).
 *
 * @param layout - The overview's geometry.
 * @param x - The press, CSS px.
 * @param view - The view's end and span, and the live end.
 * @param view.endMs - The view's end.
 * @param view.span - The view's span.
 * @param view.liveEndMs - The live end.
 * @returns ms to add to the pointer's time for the new view end.
 * @example
 * ```ts
 * grabOffset(layout, 440, { endMs: 80_000, span: 6000, liveEndMs: 140_000 }); // 3333.3
 * ```
 */
export function grabOffset(
  layout: TimelineLayout,
  x: number,
  view: { readonly endMs: number; readonly span: number; readonly liveEndMs: number }
): number {
  const t = overviewTime(layout, x, view.liveEndMs);
  const inside = t >= view.endMs - view.span && t <= view.endMs;
  return inside ? view.endMs - t : view.span / 2;
}
