/**
 * @file renderView plugin — api factory: refresh, snapshot, reveal, highlight, sortTextures,
 * filterBundle.
 */
import type { RenderViewApi, RenderViewCtx } from "./types";

/**
 * Creates the renderView api.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * createRenderViewApi(ctx).reveal({ kind: "entity", id: 1_048_580 });
 * ```
 */
export function createRenderViewApi(_ctx: RenderViewCtx): RenderViewApi {
  throw new Error("not implemented");
}
