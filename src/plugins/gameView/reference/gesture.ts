/**
 * @file gameView plugin — the area gesture on the Reference mode proxy layer (U9, A16) and the
 * Select picker layer (captures-by-day U4). A press
 * remembers where it started and takes nothing. A move of 4 client px or more turns it into an
 * area drag: the layer holds the pointer from then, the hover freezes and the marquee follows in
 * `state.reference.area` (device px, through the frame box with `pageFromClient`). The release
 * picks the area and turns the picker off. Under 4 px the release is a click: the proxy under it
 * picks, or the picker picks the element at the point, as before. Esc during the drag cancels it:
 * the release then picks nothing.
 */
import type { PageRect } from "../../panels/shared/scene";
import { pageFromClient } from "../../panels/shared/scene";
import { workspacePlugin } from "../../workspace";
import { setPicker } from "../element/select";
import { notify } from "../state";
import type { ClientPoint, GameViewCtx } from "../types";
import { pickDraggedArea } from "./area";

/**
 * One pointer event as the gesture reads it: the pointer and its client point.
 *
 * @example
 * ```ts
 * const at: PointerAt = { pointerId: 1, x: 412, y: 230 };
 * ```
 */
export type PointerAt = ClientPoint & { readonly pointerId: number };

/**
 * The client px a press must move before it becomes an area drag.
 */
export const DRAG_PX = 4;

/**
 * True when the pointer moved far enough from the press to drag an area.
 *
 * @param start - Where the press started, client px.
 * @param point - Where the pointer is, client px.
 * @returns Whether it moved 4 px or more.
 * @example
 * ```ts
 * isDrag({ x: 0, y: 0 }, { x: 3, y: 2 }); // false
 * isDrag({ x: 0, y: 0 }, { x: 0, y: -4 }); // true
 * ```
 */
export function isDrag(start: ClientPoint, point: ClientPoint): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_PX;
}

/**
 * The rect two corners span, in any order.
 *
 * @param a - One corner.
 * @param b - The opposite corner.
 * @returns The rect.
 * @example
 * ```ts
 * rectBetween({ x: 10, y: 20 }, { x: 4, y: 5 }); // { x: 4, y: 5, w: 6, h: 15 }
 * ```
 */
export function rectBetween(a: ClientPoint, b: ClientPoint): PageRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  };
}

/**
 * The marquee between the press and the pointer, in device px through the frame box.
 *
 * @param ctx - Domain context of gameView.
 * @param start - Where the press started, client px.
 * @param point - Where the pointer is, client px.
 * @returns The rect, undefined while the frame is not mounted.
 */
function marqueeOf(ctx: GameViewCtx, start: ClientPoint, point: ClientPoint): PageRect | undefined {
  const box = ctx.require(workspacePlugin).gameFrame().box();
  if (box === undefined || box.scale <= 0) return undefined;
  return rectBetween(pageFromClient(start, box), pageFromClient(point, box));
}

/**
 * A press on the layer (main button): remembered, nothing taken yet.
 *
 * @param ctx - Domain context of gameView.
 * @param at - The pointer and its client point.
 */
export function pressArea(ctx: GameViewCtx, at: PointerAt): void {
  const start = { x: at.x, y: at.y };
  ctx.state.reference.press = { pointerId: at.pointerId, start, dragging: false, cancelled: false };
}

/**
 * Drops the press of a pointer and its marquee (pointercancel).
 *
 * @param ctx - Domain context of gameView.
 * @param pointerId - The pointer.
 */
export function dropPress(ctx: GameViewCtx, pointerId: number): void {
  const { reference } = ctx.state;
  if (reference.press?.pointerId !== pointerId) return;
  reference.press = undefined;
  reference.area = undefined;
  notify(ctx.state);
}

/**
 * A move on the layer: past 4 px the press becomes an area drag and the marquee follows. A move
 * with no button down drops a press whose release the layer never saw.
 *
 * @param ctx - Domain context of gameView.
 * @param at - The pointer and its client point.
 * @param pressed - A button is down.
 * @returns True when this move started the drag: the layer takes the pointer now.
 */
export function moveArea(ctx: GameViewCtx, at: PointerAt, pressed: boolean): boolean {
  const { reference } = ctx.state;
  const { press } = reference;
  if (press === undefined || press.pointerId !== at.pointerId || press.cancelled) return false;
  if (!pressed) {
    dropPress(ctx, at.pointerId);
    return false;
  }

  // The first move past 4 px starts the drag; later moves only follow it.
  const starts = !press.dragging;
  if (starts && !isDrag(press.start, at)) return false;
  press.dragging = true;
  reference.area = marqueeOf(ctx, press.start, at);
  notify(ctx.state);
  return starts;
}

/**
 * The release on a layer: after a drag, picks the area (unless Esc cancelled it) and turns the
 * picker off like a click pick; after a click, only forgets the press and says it was a click
 * (the proxy's own pointerup picks, the picker picks at the point).
 *
 * @param ctx - Domain context of gameView.
 * @param at - The pointer and its client point.
 * @returns True for a click: no area drag ran for this release.
 */
export function releaseArea(ctx: GameViewCtx, at: PointerAt): boolean {
  const { reference } = ctx.state;
  const { press } = reference;
  if (press?.pointerId !== at.pointerId) return press?.dragging !== true;
  reference.press = undefined;
  if (!press.dragging) return true;

  reference.area = undefined;
  notify(ctx.state);
  const area = press.cancelled ? undefined : marqueeOf(ctx, press.start, at);
  if (area === undefined || area.w <= 0 || area.h <= 0) return false;

  if (ctx.state.picker.on) setPicker(ctx, false);
  void pickDraggedArea(ctx, area);
  return false;
}

/**
 * Esc during an area drag: the marquee goes and the release will pick nothing.
 *
 * @param ctx - Domain context of gameView.
 * @returns True when a drag was cancelled.
 */
export function cancelArea(ctx: GameViewCtx): boolean {
  const { reference } = ctx.state;
  const { press } = reference;
  if (press?.dragging !== true || press.cancelled) return false;
  press.cancelled = true;
  reference.area = undefined;
  notify(ctx.state);
  return true;
}
