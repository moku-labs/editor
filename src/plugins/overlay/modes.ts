/**
 * @file overlay plugin — the three modes (hidden, pill, card) and the tab: every change of mode or
 * tab writes the store and emits `overlay:changed`; a change into a visible mode slides once.
 * Before start a call only records the mode; onStart applies it over the remembered one.
 */
import { render } from "preact";
import { registerFaces } from "./fonts/register";
import { overlayCommands } from "./model/game";
import { dropCanvas } from "./paint/graph";
import { paintNow, startTick, stopTick, withAgent } from "./paint/tick";
import { layout, readViewport } from "./place/layout";
import { readInsets } from "./place/safe-area";
import { writeStored } from "./place/store";
import type { OverlayCtx, OverlayMode, OverlayTab, StoredOverlay, VisibleMode } from "./types";

/**
 * Emits `overlay:changed` with the mode and tab now.
 *
 * @param octx - Domain context.
 */
export function emitChanged(octx: OverlayCtx): void {
  octx.emit("overlay:changed", { mode: octx.state.mode, tab: octx.state.tab });
}

/**
 * The tab to show: "game" falls back to "frames" when the game registered no overlay commands.
 *
 * @param octx - Domain context.
 * @param tab - The tab asked for.
 * @returns The tab.
 */
function tabFor(octx: OverlayCtx, tab: OverlayTab): OverlayTab {
  if (tab !== "game") return tab;
  return overlayCommands(octx.registry, false).length > 0 ? "game" : "frames";
}

/**
 * Applies the state's mode to the host, inside the agent span: hidden draws nothing and runs
 * nothing; a visible mode registers the fonts (once), re-reads the viewport and the insets, lays
 * out, then starts the tick and renders now (its own span).
 *
 * @param octx - Domain context.
 */
export function applyMode(octx: OverlayCtx): void {
  const { state } = octx;
  const host = state.host;
  if (host === undefined) return;
  const hidden = state.mode === "hidden";
  withAgent(octx, () => {
    host.hidden = hidden;
    host.toggleAttribute("data-opening", state.opening);
    if (hidden) {
      layout(state);
      stopTick(state);
      if (state.container !== undefined) render(undefined, state.container);
      dropCanvas(state);
      return;
    }
    registerFaces(octx);
    readViewport(state);
    readInsets(octx);
    layout(state);
  });
  if (hidden) return;

  startTick(octx);
  paintNow(octx);
}

/**
 * Sets the mode (and the tab). Idempotent: an unchanged mode and tab do nothing. After start a
 * change slides when it goes into a visible mode, applies the mode, writes the store and emits
 * `overlay:changed`; before start it only records the mode.
 *
 * @param octx - Domain context.
 * @param mode - The new mode.
 * @param tab - The new tab; the current one by default.
 */
export function setMode(octx: OverlayCtx, mode: OverlayMode, tab?: OverlayTab): void {
  const { state } = octx;
  // Before start: only record what was asked; onStart applies it.
  if (!state.started) {
    state.asked = mode;
    state.mode = mode;
    if (mode !== "hidden") state.last = mode;
    if (tab !== undefined) state.tab = tab;
    return;
  }

  // Decide: nothing to do when the mode and the tab stay; a change into a visible mode slides.
  const nextTab = tab === undefined ? state.tab : tabFor(octx, tab);
  const previous = state.mode;
  if (previous === mode && state.tab === nextTab) return;
  const visible = mode !== "hidden";
  const entersVisible = visible && previous !== mode;

  // Update: mode, tab, the last visible mode, and the slide (hidden ends it, a tab change keeps it).
  state.mode = mode;
  state.tab = nextTab;
  if (visible) state.last = mode;
  state.opening = entersVisible || (visible && state.opening);

  // Apply and announce.
  applyMode(octx);
  writeStored(octx);
  emitChanged(octx);
}

/**
 * Shows the window: the card, or the pill; the tab when given.
 *
 * @param octx - Domain context.
 * @param options - The visible mode (default "card") and the tab.
 * @param options.mode - The visible mode.
 * @param options.tab - The card's tab.
 */
export function openOverlay(
  octx: OverlayCtx,
  options?: { readonly mode?: VisibleMode | undefined; readonly tab?: OverlayTab | undefined }
): void {
  setMode(octx, options?.mode ?? "card", options?.tab);
}

/**
 * Hides the window.
 *
 * @param octx - Domain context.
 */
export function closeOverlay(octx: OverlayCtx): void {
  setMode(octx, "hidden");
}

/**
 * Hidden → the last visible mode; pill or card → hidden.
 *
 * @param octx - Domain context.
 */
export function toggleOverlay(octx: OverlayCtx): void {
  setMode(octx, octx.state.mode === "hidden" ? octx.state.last : "hidden");
}

/**
 * Switches the card's tab (an emitting change, no slide).
 *
 * @param octx - Domain context.
 * @param tab - The tab.
 */
export function setTab(octx: OverlayCtx, tab: OverlayTab): void {
  setMode(octx, octx.state.mode, tab);
}

/**
 * Applies the start mode in onStart: a mode asked for before start, else the remembered one, else
 * `config.mode`; the tab, place and last visible mode from the store. A visible start emits
 * `overlay:changed` once.
 *
 * @param octx - Domain context.
 * @param stored - The remembered window, if any.
 */
export function applyStart(octx: OverlayCtx, stored: StoredOverlay | undefined): void {
  const { state } = octx;
  const mode = state.asked ?? stored?.mode ?? octx.config.mode;
  if (stored !== undefined) {
    state.place = stored.place;
    state.last = stored.last;
    state.tab = stored.tab;
  }
  state.tab = tabFor(octx, state.tab);
  state.mode = mode;
  state.asked = undefined;
  if (mode === "hidden") {
    applyMode(octx);
    return;
  }

  state.last = mode;
  state.opening = true;
  applyMode(octx);
  emitChanged(octx);
}
