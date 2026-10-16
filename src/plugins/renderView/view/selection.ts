/**
 * @file renderView view — range selection, step and jump (spec 09 § M11): a click selects a frame, a
 * drag of DRAG_MIN_PX or more a range; any selection pauses, is clamped to the history and is
 * scrolled into view (re-centred at 45 % of the span when it lies in the outer 8 %); step moves one
 * frame, jump to the next spike group, GC or rate change; a selection whose first frame left the
 * history is cleared.
 */
import { spikeCodeAt, spikeGroupAt } from "../series/groups";
import { newestEnd, rowAtTime, rowFromFrame, rowOfFrame } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import { rangeRows } from "../source/contract";
import type { MissionState } from "../types";
import type { FrameRange, MissionViewState } from "./types";
import { pauseView, seekView } from "./view";

/** A drag shorter than this, px, is a click (one frame), spec 09 § M11. */
export const DRAG_MIN_PX = 4;

/** A selected frame in this outer share of the span is scrolled into view. */
const EDGE_SHARE = 0.08;

/** Where a frame scrolled into view sits, as a share of the span from the left. */
const CENTRE_SHARE = 0.45;

/**
 * The range a press and a drag make: one frame under DRAG_MIN_PX, else min to max of the two
 * frames.
 *
 * @param pressFrame - The frame under the press.
 * @param pointerFrame - The frame under the pointer now.
 * @param distancePx - How far the pointer moved, px.
 * @returns The range.
 * @example
 * ```ts
 * rangeOfDrag(4810, 4860, 120); // { from: 4810, to: 4860 }
 * ```
 */
export function rangeOfDrag(
  pressFrame: number,
  pointerFrame: number,
  distancePx: number
): FrameRange {
  if (distancePx < DRAG_MIN_PX) return { from: pressFrame, to: pressFrame };
  return { from: Math.min(pressFrame, pointerFrame), to: Math.max(pressFrame, pointerFrame) };
}

/**
 * Clears the selection (Esc, Clear, Back to live).
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * clearSelection(mission);
 * mission.selection; // undefined, selectionVersion bumped
 * ```
 */
export function clearSelection(mission: MissionState): void {
  if (mission.selection === undefined) return;
  mission.selection = undefined;
  mission.selectionVersion += 1;
}

/**
 * Shows the range a drag makes while it is dragged: the painters draw it at once; the drag's end
 * selects it for real (pause, clamp, detail read) through `select`.
 *
 * @param mission - Mission control's state.
 * @param range - The frames under the press and the pointer.
 * @example
 * ```ts
 * dragSelection(mission, rangeOfDrag(4810, 4860, 120));
 * mission.selection; // { from: 4810, to: 4860 }, selectionVersion bumped
 * ```
 */
export function dragSelection(mission: MissionState, range: FrameRange): void {
  const { selection } = mission;
  if (selection?.from === range.from && selection.to === range.to) return;
  mission.selection = range;
  mission.selectionVersion += 1;
}

/**
 * Moves a paused view so a row lies inside it: a row in the outer 8 % (or outside) is placed at 45 %
 * of the span, clamped into the history.
 *
 * @param view - The view (paused).
 * @param history - The history.
 * @param row - The row to show.
 * @param liveEndMs - The live end now.
 */
function scrollIntoView(
  view: MissionViewState,
  history: PerfHistory,
  row: number,
  liveEndMs: number
): void {
  const t = history.t[row] ?? 0;
  const share = (t - (view.endMs - view.span)) / view.span;
  if (share >= EDGE_SHARE && share <= 1 - EDGE_SHARE) return;
  seekView(view, t + (1 - CENTRE_SHARE) * view.span, history, liveEndMs);
}

/**
 * Selects frames: pauses (at the live end, or the newest row before the clock started), clamps to
 * the frames the history holds, scrolls the first frame into view and bumps `selectionVersion`;
 * undefined clears the selection.
 *
 * @param mission - Mission control's state.
 * @param range - The frames; undefined clears.
 * @param liveEndMs - The live end now (pausing freezes it).
 * @returns The range kept; undefined when no frame of it is in the history.
 * @example
 * ```ts
 * selectRange(mission, { from: 4810, to: 4860 }, 80_100); // { from: 4810, to: 4860 }
 * ```
 */
export function selectRange(
  mission: MissionState,
  range: FrameRange | undefined,
  liveEndMs: number | undefined
): FrameRange | undefined {
  if (range === undefined) {
    clearSelection(mission);
    return undefined;
  }
  const { history, view } = mission;
  const { first, last } = rangeRows(history, range.from, range.to);
  if (first < 0) return undefined;
  const end = liveEndMs ?? newestEnd(history) ?? 0;
  pauseView(view, end);
  scrollIntoView(view, history, first, end);
  const kept = { from: history.frame[first] ?? range.from, to: history.frame[last] ?? range.to };
  mission.selection = kept;
  mission.selectionVersion += 1;
  return kept;
}

/**
 * The row at the centre of the view (the newest one starting at or before it).
 *
 * @param mission - Mission control's state.
 * @param liveEndMs - The live end now.
 * @returns The row; −1 without rows.
 */
function centreRow(mission: MissionState, liveEndMs: number | undefined): number {
  const { view, history } = mission;
  const end = view.live ? (liveEndMs ?? newestEnd(history) ?? 0) : view.endMs;
  return Math.max(rowAtTime(history, end - view.span / 2), history.count > 0 ? 0 : -1);
}

/**
 * The row of the selection's edge in a direction: its last frame going forward, its first going
 * back.
 *
 * @param mission - Mission control's state.
 * @param selection - The selection.
 * @param dir - 1 forward, -1 back.
 * @returns The row; −1 when the history no longer holds it.
 */
function edgeRow(mission: MissionState, selection: FrameRange, dir: 1 | -1): number {
  return rowOfFrame(mission.history, dir > 0 ? selection.to : selection.from);
}

/**
 * Steps one frame from the selection's edge (no selection: selects the frame at the view's centre);
 * stops at the newest and oldest rows.
 *
 * @param mission - Mission control's state.
 * @param dir - 1 next, -1 previous.
 * @param liveEndMs - The live end now.
 * @returns The frame selected; undefined at an end or without frames.
 * @example
 * ```ts
 * stepFrame(mission, 1, 80_100); // 4852 after f4851
 * ```
 */
export function stepFrame(
  mission: MissionState,
  dir: 1 | -1,
  liveEndMs: number | undefined
): number | undefined {
  const { history, selection } = mission;
  const row =
    selection === undefined
      ? centreRow(mission, liveEndMs)
      : edgeRow(mission, selection, dir) + dir;
  if (row < 0 || row >= history.count) return undefined;
  const frame = history.frame[row] ?? 0;
  selectRange(mission, { from: frame, to: frame }, liveEndMs);
  return frame;
}

/**
 * The frame a jump searches from, exclusive: the selection's edge, or without a selection the
 * newest frame of the view (searching back includes it).
 *
 * @param mission - Mission control's state.
 * @param dir - 1 later, -1 earlier.
 * @param liveEndMs - The live end now.
 * @returns The frame.
 */
function anchorFrame(mission: MissionState, dir: 1 | -1, liveEndMs: number | undefined): number {
  const { selection, view, history } = mission;
  if (selection !== undefined) return dir > 0 ? selection.to : selection.from;
  const end = view.live ? (liveEndMs ?? newestEnd(history) ?? 0) : view.endMs;
  const frame = history.frame[Math.max(0, rowAtTime(history, end))] ?? 0;
  return dir > 0 ? frame : frame + 1;
}

/**
 * The next spike group from a frame in a direction.
 *
 * @param history - The history.
 * @param from - The frame searched from, exclusive.
 * @param dir - 1 later, -1 earlier.
 * @returns The group's frames; undefined when none.
 */
function nextSpike(history: PerfHistory, from: number, dir: 1 | -1): FrameRange | undefined {
  const start = dir > 0 ? rowFromFrame(history, from + 1) : rowFromFrame(history, from) - 1;
  for (let row = start; row >= 0 && row < history.count; row += dir) {
    if (spikeCodeAt(history, row) === 0) continue;
    const group = spikeGroupAt(history, row);
    if (group !== undefined) return { from: group.from, to: group.to };
  }
  return undefined;
}

/**
 * The frame of an event: its own, or the row its time falls in.
 *
 * @param history - The history.
 * @param frame - The event's frame; null between frames.
 * @param t - The event's time.
 * @returns The frame; undefined when no row holds it.
 */
function eventFrame(history: PerfHistory, frame: number | null, t: number): number | undefined {
  if (frame !== null) return frame;
  const row = rowAtTime(history, t);
  return row < 0 ? undefined : history.frame[row];
}

/**
 * The nearest GC or rate change from a frame in a direction.
 *
 * @param history - The history.
 * @param kind - "gc" or "rate".
 * @param from - The frame searched from, exclusive.
 * @param dir - 1 later, -1 earlier.
 * @returns The frame; undefined when none.
 */
function nextEvent(
  history: PerfHistory,
  kind: "gc" | "rate",
  from: number,
  dir: 1 | -1
): number | undefined {
  let best: number | undefined;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== kind) continue;
    const frame = eventFrame(history, event.frame, event.t);
    if (frame === undefined || (frame - from) * dir <= 0) continue;
    if (best === undefined || (frame - best) * dir < 0) best = frame;
  }
  return best;
}

/**
 * Finds the next or previous spike group, GC frame or rate change from the selection's edge (no
 * selection: from the view's end) and selects it, a spike group whole.
 *
 * @param mission - Mission control's state.
 * @param kind - What to jump to.
 * @param dir - 1 later, -1 earlier.
 * @param liveEndMs - The live end now.
 * @returns The range selected; undefined when none (the caller toasts `noJumpText`).
 * @example
 * ```ts
 * jumpTo(mission, "spike", 1, 80_100); // { from: 4851, to: 4853 }
 * ```
 */
export function jumpTo(
  mission: MissionState,
  kind: "spike" | "gc" | "rate",
  dir: 1 | -1,
  liveEndMs: number | undefined
): FrameRange | undefined {
  const { history } = mission;
  if (history.count === 0) return undefined;
  const from = anchorFrame(mission, dir, liveEndMs);
  if (kind === "spike") {
    const group = nextSpike(history, from, dir);
    return group === undefined ? undefined : selectRange(mission, group, liveEndMs);
  }
  const frame = nextEvent(history, kind, from, dir);
  return frame === undefined
    ? undefined
    : selectRange(mission, { from: frame, to: frame }, liveEndMs);
}

/** The words of each jump target. */
const TARGET_WORDS = { spike: "spike", gc: "GC", rate: "rate change" } as const;

/**
 * The toast of a jump that found nothing.
 *
 * @param kind - What was searched.
 * @param dir - Which way.
 * @returns The text.
 * @example
 * ```ts
 * noJumpText("spike", -1); // "No spike earlier in the 2 min history"
 * ```
 */
export function noJumpText(kind: "spike" | "gc" | "rate", dir: 1 | -1): string {
  const words = TARGET_WORDS[kind];
  return dir > 0 ? `No ${words} after this point` : `No ${words} earlier in the 2 min history`;
}

/**
 * Clears a selection whose first frame left the history (the oldest rows dropped, a reset).
 *
 * @param mission - Mission control's state.
 * @returns Whether it was cleared.
 * @example
 * ```ts
 * dropStaleSelection(mission); // true two minutes after the selected frames
 * ```
 */
export function dropStaleSelection(mission: MissionState): boolean {
  const { selection, history } = mission;
  if (selection === undefined) return false;
  if (history.count > 0 && (history.frame[0] ?? 0) <= selection.from) return false;
  clearSelection(mission);
  return true;
}
