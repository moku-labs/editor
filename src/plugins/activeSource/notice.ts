/**
 * @file activeSource plugin — the disconnect notice and the timeline markers (spec 11 § 4 B3, B6):
 * one notice at a time, closed by its timer after noticeMs, by dismissNotice, a rejoin or an
 * explicit choice; markers newest last, at most config.markers.
 */
import type { ActiveSourceConfig, ActiveSourceState, SourceMarker, SourceNotice } from "./types";

/**
 * Adds a marker, dropping the oldest beyond config.markers.
 *
 * @param state - activeSource state.
 * @param config - activeSource config.
 * @param marker - The marker.
 */
export function addMarker(
  state: ActiveSourceState,
  config: Readonly<ActiveSourceConfig>,
  marker: SourceMarker
): void {
  state.markers.push(marker);
  const extra = state.markers.length - config.markers;
  if (extra > 0) state.markers.splice(0, extra);
}

/**
 * Shows a notice for noticeMs, replacing the one that shows.
 *
 * @param state - activeSource state.
 * @param config - activeSource config.
 * @param notice - The notice without its end.
 */
export function showNotice(
  state: ActiveSourceState,
  config: Readonly<ActiveSourceConfig>,
  notice: Omit<SourceNotice, "until">
): void {
  clearTimeout(state.timers.notice);
  state.notice = { ...notice, until: Date.now() + config.noticeMs };
  state.timers.notice = setTimeout(() => closeNotice(state), config.noticeMs);
}

/**
 * Keeps the notice showing with a new text and no end (Reconnect is waiting for the device).
 *
 * @param state - activeSource state.
 * @param text - The new text.
 */
export function holdNotice(state: ActiveSourceState, text: string): void {
  if (state.notice === undefined) return;
  clearTimeout(state.timers.notice);
  state.timers.notice = undefined;
  state.notice = { ...state.notice, text, until: Number.POSITIVE_INFINITY };
}

/**
 * Marks the notice of a device as "back" (its device is listed again: Reconnect can use it now).
 *
 * @param state - activeSource state.
 * @param device - The device id.
 */
export function markBack(state: ActiveSourceState, device: string): void {
  if (state.notice?.device === device && !state.notice.back) {
    state.notice = { ...state.notice, back: true };
  }
}

/**
 * Closes the notice now.
 *
 * @param state - activeSource state.
 */
export function closeNotice(state: ActiveSourceState): void {
  clearTimeout(state.timers.notice);
  state.timers.notice = undefined;
  state.notice = undefined;
}
