/**
 * @file gameView plugin — the small view-state setters the components call: side tab, stage zoom,
 * safe-area guides, series chips and the capture card hold. Each mutates state and notifies.
 */
import { notify } from "./state";
import type { GameViewState } from "./types";

/**
 * Shows a side-panel tab.
 *
 * @param state - gameView state.
 * @param tab - "element" or "device".
 */
export function setTab(state: GameViewState, tab: GameViewState["tab"]): void {
  state.tab = tab;
  notify(state);
}

/**
 * Sets the stage zoom (the Stage docks again).
 *
 * @param state - gameView state.
 * @param zoom - "fit" or "100".
 */
export function setZoom(state: GameViewState, zoom: GameViewState["zoom"]): void {
  state.zoom = zoom;
  notify(state);
}

/**
 * Flips the safe-area guides.
 *
 * @param state - gameView state.
 */
export function toggleSafeArea(state: GameViewState): void {
  state.safeArea = !state.safeArea;
  notify(state);
}

/**
 * Chooses the series length in the popover.
 *
 * @param state - gameView state.
 * @param durationMs - One of the duration chips.
 */
export function setSeriesDuration(state: GameViewState, durationMs: number): void {
  state.series.durationMs = durationMs;
  notify(state);
}

/**
 * Chooses the series interval in the popover.
 *
 * @param state - gameView state.
 * @param intervalMs - One of the interval chips.
 */
export function setSeriesInterval(state: GameViewState, intervalMs: number): void {
  state.series.intervalMs = intervalMs;
  notify(state);
}

/**
 * Marks the capture card hovered or focused (it then stays past captureCardMs).
 *
 * @param state - gameView state.
 * @param held - True while hovered or focused.
 */
export function holdCard(state: GameViewState, held: boolean): void {
  state.cardHeld = held;
}
