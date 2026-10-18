/**
 * @file recorder plugin — the hooks. Every command run (overlay, bridge, local) becomes the one
 * `command` event line of the log through the registry's `registry:command`; the editor's window
 * becomes a `devtools` event (never `overlay`: that name is the game's overlays, engine spec 22).
 * Both write whether or not a log records: the listener queues them only while recording.
 */
import type { RecorderCtx, RecorderHooks } from "./types";

/**
 * Builds the recorder's hooks.
 *
 * @param ctx - The recorder's context.
 * @returns The `overlay:changed` and `registry:command` handlers.
 */
export function createRecorderHooks(ctx: RecorderCtx): RecorderHooks {
  const { state } = ctx;
  return {
    "overlay:changed": ({ mode, tab }) => {
      state.monitor?.event("devtools", { mode, tab });
    },
    "registry:command": ({ id, input, via, ok }) => {
      state.monitor?.event("command", { id, input, via, ok });
    }
  };
}
