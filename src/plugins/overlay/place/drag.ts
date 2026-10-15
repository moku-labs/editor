/**
 * @file overlay plugin — moves the window by its grip: a primary-button press captures the
 * pointer; past `DRAG_SLOP` the host moves by transform only (no render, no layout write); the
 * release snaps to the nearer edge, lays out and writes the store. Arrow keys on the grip move it
 * by `KEY_STEP` or pick the edge. A place change emits nothing.
 */
import type { OverlayCtx, Place } from "../types";
import { DRAG_SLOP, KEY_STEP } from "../types";
import { snap } from "./dock";
import { currentTop, layout, sizeNow } from "./layout";
import { writeStored } from "./store";

/**
 * The pointer event members the grip reads.
 */
export type PointerLike = {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly currentTarget: EventTarget | null;
};

/**
 * The key event members the grip reads.
 */
export type KeyLike = { readonly key: string; preventDefault(): void };

/**
 * Captures the pointer on the grip; a synthetic pointer the page does not know is ignored.
 *
 * @param target - The grip.
 * @param id - The pointer id.
 */
function capture(target: EventTarget | null, id: number): void {
  if (target === null || !("setPointerCapture" in target)) return;
  const setCapture = target.setPointerCapture;
  if (typeof setCapture !== "function") return;
  try {
    setCapture.call(target, id);
  } catch {
    // A pointer the page has no record of (a synthetic event): the drag works without capture.
  }
}

/**
 * Puts the window at a place: clears the drag transform, lays out, writes the store.
 *
 * @param octx - Domain context.
 * @param place - The new place.
 */
function movePlace(octx: OverlayCtx, place: Place): void {
  const { state } = octx;
  state.place = place;
  state.host?.style.removeProperty("transform");
  layout(state);
  writeStored(octx);
}

/**
 * A primary-button press on the grip starts a drag.
 *
 * @param octx - Domain context.
 * @param event - The pointerdown.
 */
export function gripDown(octx: OverlayCtx, event: PointerLike): void {
  const { state } = octx;
  if (event.button !== 0 || state.mode === "hidden") return;
  capture(event.currentTarget, event.pointerId);
  state.drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    top: currentTop(state),
    moved: false
  };
}

/**
 * A move of the dragging pointer past the slop moves the host by transform only.
 *
 * @param octx - Domain context.
 * @param event - The pointermove.
 */
export function gripMove(octx: OverlayCtx, event: PointerLike): void {
  const drag = octx.state.drag;
  if (drag === undefined || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
  drag.moved = true;
  octx.state.host?.style.setProperty("transform", `translate(${dx}px, ${dy}px)`);
}

/**
 * The release (or cancel) of a drag: a moved window snaps to the nearer edge; a press without
 * travel does nothing.
 *
 * @param octx - Domain context.
 * @param event - The pointerup or pointercancel.
 */
export function gripUp(octx: OverlayCtx, event: PointerLike): void {
  const { state } = octx;
  const drag = state.drag;
  if (drag === undefined || event.pointerId !== drag.id) return;
  state.drag = undefined;
  if (!drag.moved) return;

  const size = sizeNow(state);
  const left =
    state.place.dock === "left"
      ? state.insets.left
      : state.viewport.w - state.insets.right - size.w;
  const drop = {
    centerX: left + (event.clientX - drag.x) + size.w / 2,
    top: drag.top + (event.clientY - drag.y)
  };
  movePlace(octx, snap(drop, size, state.viewport, state.insets));
}

/**
 * Arrow keys on the grip: up and down move the window by `KEY_STEP` on its edge, left and right
 * pick the edge.
 *
 * @param octx - Domain context.
 * @param event - The keydown.
 */
export function gripKey(octx: OverlayCtx, event: KeyLike): void {
  const { state } = octx;
  const { dock, y } = state.place;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    movePlace(octx, { dock: event.key === "ArrowLeft" ? "left" : "right", y });
    return;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

  event.preventDefault();
  const step = event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP;
  const centerX = dock === "left" ? 0 : state.viewport.w;
  const size = sizeNow(state);
  movePlace(
    octx,
    snap({ centerX, top: currentTop(state) + step }, size, state.viewport, state.insets)
  );
}
