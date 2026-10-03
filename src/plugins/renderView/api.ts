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
 */
export function createRenderViewApi(ctx: RenderViewCtx): RenderViewApi {
  return {
    refresh: () => refreshRenderView(ctx),
    snapshot: () => deriveSnapshot(ctx.state),
    reveal: ref => revealRef(ctx, ref),
    highlight: ref => highlightRef(ctx, ref),
    sortTextures: key => sortBy(ctx, key),
    filterBundle: bundle => filterTo(ctx, bundle)
  };
}
