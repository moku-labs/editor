/**
 * @file renderView view — live, pause, seek and the span (spec 09 § M11): live, the view's end is
 * the display clock's right edge every frame; paused, it stays at `endMs` while the history keeps
 * filling ("Paused · N s behind live"). A seek pauses and is clamped into the history; a span change
 * keeps the end; a paused view whose start left the history is pushed forward.
 */
import { newestEnd } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import type { MissionState } from "../types";
import { liveEnd } from "./clock";
import type { DisplayClock, MissionSpan, MissionViewState } from "./types";

/** The spans of the view, ms (spec 09 § M12). */
export const SPANS: readonly MissionSpan[] = [6000, 30_000, 120_000];

/**
 * The right edge of the live view now, outside the paint loop (an api call, a key): the display
 * clock stepped to `now`, in the mode of its last frame — the reduced-motion step when the loop
 * last painted with it, else the playout clock.
 *
 * @param clock - The display clock.
 * @param now - `performance.now()`.
 * @returns Source-clock ms; undefined before the first arrival.
 * @example
 * ```ts
 * clockEnd(mission.clock, performance.now()); // 78_420: a delay behind the newest frame
 * ```
 */
export function clockEnd(clock: DisplayClock, now: number): number | undefined {
  return liveEnd(clock, now, clock.stepMs !== undefined && clock.stepAt > clock.at);
}

/**
 * Freezes the view's end at the live end; nothing before the first frames arrived.
 *
 * @param view - The view.
 * @param liveEndMs - The live end now; undefined before the first frames.
 * @returns Whether the view is paused now.
 * @example
 * ```ts
 * pauseView(mission.view, 78_420); // true: "Paused · 0.0 s behind live"
 * ```
 */
export function pauseView(view: MissionViewState, liveEndMs: number | undefined): boolean {
  if (!view.live) return true;
  if (liveEndMs === undefined) return false;
  view.live = false;
  view.endMs = liveEndMs;
  return true;
}

/**
 * Back to live: the view follows the clock and the selection is cleared.
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * liveView(mission);
 * mission.selection; // undefined
 * ```
 */
export function liveView(mission: MissionState): void {
  mission.view.live = true;
  if (mission.selection === undefined) return;
  mission.selection = undefined;
  mission.selectionVersion += 1;
}

/**
 * The lowest end a paused view may have: one span after the oldest frame, but never past live.
 *
 * @param view - The view.
 * @param history - The history.
 * @param liveEndMs - The live end now.
 * @returns Source-clock ms.
 */
function lowestEnd(view: MissionViewState, history: PerfHistory, liveEndMs: number): number {
  const oldest = history.count > 0 ? (history.t[0] ?? liveEndMs) : liveEndMs;
  return Math.min(oldest + view.span, liveEndMs);
}

/**
 * Pauses and moves the view's end, clamped into `[min(oldest + span, liveEnd), liveEnd]`.
 *
 * @param view - The view.
 * @param endMs - The asked end, source clock.
 * @param history - The history the end is clamped into.
 * @param liveEndMs - The live end now.
 * @example
 * ```ts
 * seekView(mission.view, 40_000, mission.history, 78_420); // paused 38.4 s behind live
 * ```
 */
export function seekView(
  view: MissionViewState,
  endMs: number,
  history: PerfHistory,
  liveEndMs: number
): void {
  view.live = false;
  view.endMs = Math.min(liveEndMs, Math.max(lowestEnd(view, history, liveEndMs), endMs));
}

/**
 * Sets the span; the view's end is kept (live stays live).
 *
 * @param view - The view.
 * @param span - The new span.
 * @example
 * ```ts
 * setViewSpan(mission.view, 30_000);
 * mission.view.endMs; // unchanged: the end is kept
 * ```
 */
export function setViewSpan(view: MissionViewState, span: MissionSpan): void {
  view.span = span;
}

/**
 * Pushes a paused view forward when its start left the history (the oldest rows dropped, or a
 * longer span). A live view is left alone.
 *
 * @param view - The view.
 * @param history - The history.
 * @param liveEndMs - The live end now.
 * @example
 * ```ts
 * keepInHistory(mission.view, mission.history, 138_000); // a view rewound 2 min ago moves on
 * ```
 */
export function keepInHistory(
  view: MissionViewState,
  history: PerfHistory,
  liveEndMs: number
): void {
  if (view.live) return;
  view.endMs = Math.min(liveEndMs, Math.max(view.endMs, lowestEnd(view, history, liveEndMs)));
}

/**
 * The view's end now: the live end while live, the frozen end while paused.
 *
 * @param view - The view.
 * @param liveEndMs - The live end now.
 * @returns Source-clock ms; undefined live before the first frames.
 * @example
 * ```ts
 * viewEnd(mission.view, 78_420); // 40_000 while paused there
 * ```
 */
export function viewEnd(view: MissionViewState, liveEndMs: number | undefined): number | undefined {
  return view.live ? liveEndMs : view.endMs;
}

/**
 * How far the paused view is behind live ("Paused · N s behind live").
 *
 * @param view - The view.
 * @param liveEndMs - The live end now.
 * @returns ms; 0 while live or before the first frames.
 * @example
 * ```ts
 * behindMs(mission.view, 78_420); // 38_420
 * ```
 */
export function behindMs(view: MissionViewState, liveEndMs: number | undefined): number {
  if (view.live || liveEndMs === undefined) return 0;
  return Math.max(0, liveEndMs - view.endMs);
}

/**
 * The view as a component renders it (outside the paint loop): the live end (the display clock, or
 * the newest frame's end before the clock ran), the view's end and start, how far it is behind.
 *
 * @example
 * ```ts
 * const window: ViewWindow = { liveEndMs: 80_100, endMs: 80_100, startMs: 74_100, behindMs: 0 };
 * ```
 */
export type ViewWindow = {
  readonly liveEndMs: number | undefined;
  readonly endMs: number;
  readonly startMs: number;
  readonly behindMs: number;
};

/**
 * The view now: live, its end is the display clock's right edge; paused, its frozen end.
 *
 * @param mission - Mission control's state.
 * @param now - `performance.now()`.
 * @returns The window.
 * @example
 * ```ts
 * viewWindow(mission, performance.now()).startMs; // 74_100: six seconds before the live end
 * ```
 */
export function viewWindow(mission: MissionState, now: number): ViewWindow {
  const liveEndMs = clockEnd(mission.clock, now) ?? newestEnd(mission.history);
  const endMs = viewEnd(mission.view, liveEndMs) ?? 0;
  return {
    liveEndMs,
    endMs,
    startMs: endMs - mission.view.span,
    behindMs: behindMs(mission.view, liveEndMs)
  };
}
