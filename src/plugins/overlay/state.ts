/**
 * @file overlay plugin — state factory.
 */
import type { Config, OverlayState } from "./types";

/**
 * Creates the initial overlay state: closed, not mounted, empty. `config.open` is honoured by
 * onStart, so the flag starts false (the overlay is off unless switched on).
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns Closed, empty state.
 */
export function createOverlayState(_ctx: { readonly config: Readonly<Config> }): OverlayState {
  return {
    open: false,
    host: undefined,
    root: undefined,
    hasBridge: false,
    link: undefined,
    session: undefined,
    render: undefined,
    renderUnavailable: false,
    stopRender: undefined,
    paintTimer: undefined,
    busy: new Set(),
    results: new Map(),
    cheats: [],
    isolate: undefined
  };
}
