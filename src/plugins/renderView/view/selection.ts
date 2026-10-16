/**
 * @file renderView view — range selection, step and jump (spec 09 § M11): any selection pauses;
 * a selected frame is scrolled into view; a selection whose first frame leaves the history is
 * cleared. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 3 (RV1) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MissionState } from "../types";
import type { FrameRange } from "./types";

/** A drag shorter than this, px, is a click (one frame), spec 09 § M11. */
export const DRAG_MIN_PX = 4;

/**
 * The range a press and a drag make: one frame under DRAG_MIN_PX, else min to max of the two
 * frames.
 *
 * @param _pressFrame - The frame under the press.
 * @param _pointerFrame - The frame under the pointer now.
 * @param _distancePx - How far the pointer moved, px.
 * @returns The range.
 * @throws {Error} Until build wave 3: "renderView view/rangeOfDrag is not built yet".
 */
export function rangeOfDrag(
  _pressFrame: number,
  _pointerFrame: number,
  _distancePx: number
): FrameRange {
  return notBuilt("view/rangeOfDrag", 3);
}

/**
 * Selects frames: pauses, clamps to the history, scrolls into view (re-centred at 45 % of the
 * span when in the outer 8 %), bumps selectionVersion.
 *
 * @param _mission - Mission control's state.
 * @param _range - The frames; undefined clears.
 * @param _liveEndMs - liveEnd() now (pausing freezes it).
 * @returns The range kept; undefined when no frame of it is in the history.
 * @throws {Error} Until build wave 3: "renderView view/selectRange is not built yet".
 */
export function selectRange(
  _mission: MissionState,
  _range: FrameRange | undefined,
  _liveEndMs: number | undefined
): FrameRange | undefined {
  return notBuilt("view/selectRange", 3);
}

/**
 * Steps one frame from the selection's edge (no selection: the frame at the view's centre);
 * stops at the newest and oldest rows.
 *
 * @param _mission - Mission control's state.
 * @param _dir - 1 next, -1 previous.
 * @param _liveEndMs - liveEnd() now.
 * @returns The frame selected; undefined at an end or without frames.
 * @throws {Error} Until build wave 3: "renderView view/stepFrame is not built yet".
 */
export function stepFrame(
  _mission: MissionState,
  _dir: 1 | -1,
  _liveEndMs: number | undefined
): number | undefined {
  return notBuilt("view/stepFrame", 3);
}

/**
 * Finds the next or previous spike group, GC frame or rate change from the selection's edge and
 * selects it (a spike group whole).
 *
 * @param _mission - Mission control's state.
 * @param _kind - What to jump to.
 * @param _dir - 1 later, -1 earlier.
 * @param _liveEndMs - liveEnd() now.
 * @returns The range selected; undefined when none (the caller toasts).
 * @throws {Error} Until build wave 3: "renderView view/jumpTo is not built yet".
 */
export function jumpTo(
  _mission: MissionState,
  _kind: "spike" | "gc" | "rate",
  _dir: 1 | -1,
  _liveEndMs: number | undefined
): FrameRange | undefined {
  return notBuilt("view/jumpTo", 3);
}
