/**
 * @file overlay plugin — the global channel `globalThis.__MOKU_GAME_OVERLAY__` (engine spec 12 H4.1,
 * LEAD-FIXES-2): set in onStart, deleted in onStop only when it still holds this overlay's object.
 * The engine's `app.debug.overlay.*` (and `config.debug.overlay` after `startAgents`) call it; the
 * overlay never reads the engine's setting itself.
 */
import { closeOverlay, openOverlay, toggleOverlay } from "./modes";
import type { OverlayChannel, OverlayCtx, OverlayState } from "./types";

/**
 * Sets the global channel: `open` opens the pill for `{ mode: "pill" }` and the card for anything
 * else (a typo still opens something).
 *
 * @param octx - Domain context.
 */
export function setChannel(octx: OverlayCtx): void {
  const channel: OverlayChannel = {
    open: options => {
      openOverlay(octx, { mode: options?.mode === "pill" ? "pill" : "card" });
    },
    close: () => {
      closeOverlay(octx);
    },
    toggle: () => {
      toggleOverlay(octx);
    },
    isOpen: () => octx.state.mode !== "hidden"
  };
  globalThis.__MOKU_GAME_OVERLAY__ = channel;
  octx.state.channel = channel;
}

/**
 * Deletes the global channel when it is this overlay's (a second agent started later on the same
 * page keeps its own).
 *
 * @param state - Overlay state.
 */
export function clearChannel(state: OverlayState): void {
  if (state.channel !== undefined && globalThis.__MOKU_GAME_OVERLAY__ === state.channel) {
    Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
  }
  state.channel = undefined;
}
