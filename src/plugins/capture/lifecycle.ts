/**
 * @file capture plugin — onInit (add the four commands to the registry) and onStop (end a
 * running series: the pending call resolves with the shots so far).
 */
import { registryPlugin } from "../registry";
import { decodePicture } from "./canvas";
import { registerCaptureCommands } from "./commands";
import { browserClock, stopSeries } from "./series";
import type { CaptureCtx, CaptureState } from "./types";

/**
 * onInit: adds editor.capture, editor.series, editor.seriesStop and editor.sheet to the registry. Runs in init
 * because the registry builds its manifest from the entries added before start.
 *
 * @param ctx - Plugin context of capture.
 * @throws {Error} When an id is already in the registry (createApp fails loudly).
 */
export function initCapture(ctx: CaptureCtx): void {
  registerCaptureCommands(ctx.require(registryPlugin), {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    clock: browserClock,
    decode: decodePicture
  });
}

/**
 * onStop: ends a running series (stop flag, timer cleared, wait woken); no timer outlives the app.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopCapture(ctx: { readonly state: CaptureState }): void {
  stopSeries(ctx.state);
}
