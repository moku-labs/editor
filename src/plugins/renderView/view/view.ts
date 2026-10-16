/**
 * @file renderView view — pause, live, seek and the span (spec 09 § M11): live, the view's end
 * is liveEnd() every frame; paused, it stays at endMs while the history keeps filling. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV1) writes the bodies.
 */
import type { PerfHistory } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionState } from "../types";
import type { MissionSpan, MissionViewState } from "./types";

/** The spans of the view, ms (spec 09 § M12). */
export const SPANS: readonly MissionSpan[] = [6000, 30_000, 120_000];

/**
 * Freezes the view's end at liveEnd(); nothing without frames.
 *
 * @param _view - The view.
 * @param _liveEndMs - liveEnd() now; undefined before the first frames.
 * @returns Whether the view paused.
 * @throws {Error} Until build wave 3: "renderView view/pauseView is not built yet".
 */
export function pauseView(_view: MissionViewState, _liveEndMs: number | undefined): boolean {
  return notBuilt("view/pauseView", 3);
}

/**
 * Back to live: the view follows the clock and the selection is cleared.
 *
 * @param _mission - Mission control's state.
 * @throws {Error} Until build wave 3: "renderView view/liveView is not built yet".
 */
export function liveView(_mission: MissionState): void {
  notBuilt("view/liveView", 3);
}

/**
 * Pauses and moves the view's end, clamped into `[min(firstT + span, liveEnd), liveEnd]`.
 *
 * @param _view - The view.
 * @param _endMs - The asked end, source clock.
 * @param _history - The history the end is clamped into.
 * @param _liveEndMs - liveEnd() now.
 * @throws {Error} Until build wave 3: "renderView view/seekView is not built yet".
 */
export function seekView(
  _view: MissionViewState,
  _endMs: number,
  _history: PerfHistory,
  _liveEndMs: number
): void {
  notBuilt("view/seekView", 3);
}

/**
 * Sets the span; the view's end is kept.
 *
 * @param _view - The view.
 * @param _span - The new span.
 * @throws {Error} Until build wave 3: "renderView view/setViewSpan is not built yet".
 */
export function setViewSpan(_view: MissionViewState, _span: MissionSpan): void {
  notBuilt("view/setViewSpan", 3);
}

/**
 * The view's end now: liveEnd() while live, endMs while paused.
 *
 * @param _view - The view.
 * @param _liveEndMs - liveEnd() now.
 * @returns Source-clock ms; undefined live before the first frames.
 * @throws {Error} Until build wave 3: "renderView view/viewEnd is not built yet".
 */
export function viewEnd(
  _view: MissionViewState,
  _liveEndMs: number | undefined
): number | undefined {
  return notBuilt("view/viewEnd", 3);
}
