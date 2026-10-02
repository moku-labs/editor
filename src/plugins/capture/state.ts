/**
 * @file capture plugin — state factory.
 */
import type { CaptureState, Config } from "./types";

/**
 * Creates the initial capture state: no series.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createCaptureState({ config: { maxDurationMs: 20_000, minIntervalMs: 16 } }); // { series: undefined }
 * ```
 */
export function createCaptureState(_ctx: { readonly config: Readonly<Config> }): CaptureState {
  throw new Error("not implemented");
}
