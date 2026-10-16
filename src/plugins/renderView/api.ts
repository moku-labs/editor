/**
 * @file renderView plugin — api factory: the scene cards' refresh, snapshot, reveal, highlight,
 * sortTextures, filterBundle, and Mission control's members (mission, inspect, pause, live, setSpan,
 * seek, select, step, jump, setRate, setSection, setOverdraw, record, mark), which are typed stubs
 * until build wave 3 (RV4). The contract of each member lives on RenderViewApi in types.ts.
 */
import { filterTo, highlightRef, revealRef, sortBy } from "./actions";
import { deriveSnapshot } from "./derive";
import { notBuilt } from "./stub";
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
    filterBundle: bundle => filterTo(ctx, bundle),
    mission: () => notBuilt("api.mission", 3),
    inspect: () => notBuilt("api.inspect", 3),
    pause: () => notBuilt("api.pause", 3),
    live: () => notBuilt("api.live", 3),
    setSpan: () => notBuilt("api.setSpan", 3),
    seek: () => notBuilt("api.seek", 3),
    select: () => notBuilt("api.select", 3),
    step: () => notBuilt("api.step", 3),
    jump: () => notBuilt("api.jump", 3),
    setRate: () => notBuilt("api.setRate", 3),
    setSection: () => notBuilt("api.setSection", 3),
    setOverdraw: () => notBuilt("api.setOverdraw", 3),
    record: () => notBuilt("api.record", 3),
    mark: () => notBuilt("api.mark", 3)
  };
}
