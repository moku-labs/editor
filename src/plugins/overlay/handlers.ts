/**
 * @file overlay plugin — hooks: the global `bridge:status` (the bridge is opt-in, so no dependency)
 * and the recorder's per-plugin `recorder:status` (through `depends`). Both only store the payload:
 * the next tick shows it. They read no other plugin (the kernel builds hooks before the apis).
 */
import type { OverlayHooks, OverlayState } from "./types";

/**
 * The overlay's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Plugin context of the overlay (only its state is read).
 * @param ctx.state - Own state.
 * @returns The hook map.
 */
export function createHandlers(ctx: { readonly state: OverlayState }): OverlayHooks {
  const { state } = ctx;
  return {
    "bridge:status": payload => {
      state.link = payload;
    },
    "recorder:status": payload => {
      state.rec = payload;
    }
  };
}
