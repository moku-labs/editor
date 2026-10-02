/**
 * @file capture plugin — builds the editor.capture, editor.series and editor.seriesStop entries
 * and adds them to the registry.
 */
import type { CaptureDeps, CaptureRegistry } from "./types";

/**
 * Adds the three capture commands (ids, inputs, effects from contracts §3 and R2).
 *
 * @param _registry - The registry slice (add, command, envelope).
 * @param _deps - Config, state, log and clock.
 * @example
 * ```ts
 * registerCaptureCommands(ctx.require(registryPlugin), { config, state, log, clock: browserClock });
 * ```
 */
export function registerCaptureCommands(_registry: CaptureRegistry, _deps: CaptureDeps): void {
  throw new Error("not implemented");
}
