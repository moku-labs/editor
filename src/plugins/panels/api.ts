/**
 * @file panels plugin — api factory: register, run, list, mountInto.
 */
import type { PanelsApi, PanelsCtx } from "./types";

/**
 * Creates the panels api.
 *
 * @param _ctx - Domain context of panels.
 * @example
 * ```ts
 * const unmount = createPanelsApi(ctx).mountInto("flow", workspace.host("flow"));
 * ```
 */
export function createPanelsApi(_ctx: PanelsCtx): PanelsApi {
  throw new Error("not implemented");
}
