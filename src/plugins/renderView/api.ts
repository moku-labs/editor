/**
 * @file renderView plugin — api factory: refresh, snapshot, reveal, highlight, sortTextures,
 * filterBundle. The contract of each member lives on RenderViewApi in types.ts.
 */
import { filterTo, highlightRef, revealRef, sortBy } from "./actions";
import { deriveSnapshot } from "./derive";
import type { RenderViewApi, RenderViewCtx } from "./types";
import { refreshRenderView } from "./watch";

/**
 * Creates the renderView api over the plugin state.
 *
 * @param ctx - Domain context of renderView.
 * @returns The api.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { api: createRenderViewApi });
 * ```
 */
export function createRenderViewApi(ctx: RenderViewCtx): RenderViewApi {
  return {
    /** @inheritDoc */
    refresh: () => refreshRenderView(ctx),
    /** @inheritDoc */
    snapshot: () => deriveSnapshot(ctx.state),
    /** @inheritDoc */
    reveal: ref => revealRef(ctx, ref),
    /** @inheritDoc */
    highlight: ref => highlightRef(ctx, ref),
    /** @inheritDoc */
    sortTextures: key => sortBy(ctx, key),
    /** @inheritDoc */
    filterBundle: bundle => filterTo(ctx, bundle)
  };
}
