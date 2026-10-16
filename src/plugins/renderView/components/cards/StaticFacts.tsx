/**
 * @file renderView components (cards) — the static facts row (spec 09 § M9 Static facts): the scene's
 * entities with a view, the loaded bundles, the pools, the dpr, and the dashed source line "Every
 * number on this page is from {name}" (", the local preview is paused" on a device); with nothing
 * running, one dashed chip saying the cards fill in once a source runs.
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { DASH, oneDecimal } from "../../derive/words";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { useRenderView } from "../useRenderView";

/**
 * Props of `StaticFacts`.
 */
export type StaticFactsProps = { readonly ctx: RenderViewCtx };

/**
 * The static facts row.
 *
 * @param props - ctx.
 * @returns The row.
 */
export function StaticFacts(props: StaticFactsProps): JSX.Element {
  const { ctx } = props;
  const { state } = ctx;
  useRenderView(state, () => state.render);
  const activeSource = ctx.require(activeSourcePlugin);
  const source = state.mission.source ?? activeSource.current();
  if (source.kind === "local" && source.session === null) {
    return (
      <section data-render="facts" aria-label="Static facts">
        <p data-fact-chip data-source-line>
          No source: the cards fill in once the local preview runs or a device connects.
        </p>
      </section>
    );
  }
  const device = source.kind === "device";
  const views = state.render?.views;
  const pooled = state.render?.pooled;
  const dpr = state.mission.second?.display?.dpr;
  return (
    <section data-render="facts" aria-label="Static facts">
      <p data-fact-chip title="Entities with a view (game.render views)">
        Scene <b>{views ?? DASH}</b> entities
      </p>
      <p data-fact-chip>
        Bundles <b>{state.assets?.bundles.length ?? DASH}</b> loaded
      </p>
      <p data-fact-chip>
        Pools {pooled === 0 ? <b>none</b> : <b>{pooled ?? DASH}</b>}
        {pooled === 0 ? " declared" : " pooled"}
      </p>
      <p data-fact-chip>
        dpr <b>{dpr === undefined ? DASH : oneDecimal(dpr)}</b>
      </p>
      <p data-fact-chip data-source-line>
        <MissionIcon name={device ? "phone" : "laptop"} size={14} />
        <span>
          Every number on this page is from <b>{activeSource.label().name}</b>
          {device ? ", the local preview is paused" : ""}
        </span>
      </p>
    </section>
  );
}
