/**
 * @file capture plugin — onInit (add the three commands to the registry) and onStop (end a
 * running series: the pending call resolves with the shots so far).
 */
import type { CaptureCtx, CaptureState } from "./types";

/**
 * onInit: `registerCaptureCommands(ctx.require(registryPlugin), { config, state, log, clock: browserClock })`.
 *
 * @param _ctx - Plugin context of capture.
 * @example
 * ```ts
 * createAgentPlugin("capture", { onInit: initCapture });
 * ```
 */
export function initCapture(_ctx: CaptureCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: stopRequested = true, clears the wait timer, wakes the loop.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createAgentPlugin("capture", { onStop: stopCapture });
 * ```
 */
export function stopCapture(_ctx: { readonly state: CaptureState }): void {
  throw new Error("not implemented");
}
