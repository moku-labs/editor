/**
 * @file renderView components (scene) — "Scene details" (spec 09 § M9 Scene details): one collapsible
 * section after the Shaders & passes panel, collapsed by default (open for the life of the page, not
 * persisted). Its header names what is inside and the frame of the last game.render; open, it holds
 * the scene cards unchanged — render tree and textures on the left, bundles, pools and the release
 * log on the right, one column on a narrow page. Collapsed, none of them renders.
 */
import type { JSX } from "preact";
import type { WorkspaceApi } from "../../../workspace/types";
import { deriveSnapshot, treeCounts } from "../../derive";
import { notifyMission } from "../../state";
import type { RenderViewCtx } from "../../types";
import { BundlesCard } from "../BundlesCard";
import { MissionIcon } from "../icons";
import { PoolsCard } from "../PoolsCard";
import { ReleaseLogCard } from "../ReleaseLogCard";
import { RenderTreeCard } from "../RenderTreeCard";
import { TexturesCard } from "../TexturesCard";
import { useRenderView } from "../useRenderView";

/**
 * Props of `SceneDetails`.
 */
export type SceneDetailsProps = { readonly ctx: RenderViewCtx; readonly workspace: WorkspaceApi };

/**
 * The scene cards inside the open section (subscribed to the scene store: the scene's values
 * re-render them, Mission control's do not).
 *
 * @param props - ctx and the workspace api.
 * @returns The cards.
 */
function SceneCards(props: SceneDetailsProps): JSX.Element {
  const { ctx, workspace } = props;
  const snapshot = useRenderView(ctx.state, () => deriveSnapshot(ctx.state));
  return (
    <div data-part="body" id="render-scene-body">
      {ctx.state.error === undefined ? undefined : (
        <p role="status" data-error>
          {ctx.state.error}
        </p>
      )}
      <div data-columns>
        <div data-column="left">
          <RenderTreeCard ctx={ctx} rows={snapshot.tree} workspace={workspace} />
          <TexturesCard ctx={ctx} rows={snapshot.textures} />
        </div>
        <div data-column="right">
          <BundlesCard rows={snapshot.bundles} assets={ctx.state.assets} />
          <PoolsCard pools={snapshot.pools} />
          <ReleaseLogCard releases={snapshot.releases} />
        </div>
      </div>
    </div>
  );
}

/**
 * A count and its noun, singular for one: "1 bundle", "3 bundles".
 *
 * @param count - The count.
 * @param noun - The noun, singular.
 * @returns The words.
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The header's counts: the frame of the last game.render, the scene's nodes, the textures and the
 * bundles.
 *
 * @param ctx - Domain context of renderView.
 * @returns The words.
 */
function sceneMeta(ctx: RenderViewCtx): string {
  const { state } = ctx;
  const frame = state.lastFrame === undefined ? "frame —" : `frame ${state.lastFrame}`;
  const nodes = treeCounts(state.scene).nodes;
  const textures = state.render?.textures ?? 0;
  const bundles = state.assets?.bundles.length ?? 0;
  return `${frame} · ${counted(nodes, "node")} · ${counted(textures, "texture")} · ${counted(bundles, "bundle")}`;
}

/**
 * The Scene details section.
 *
 * @param props - ctx and the workspace api.
 * @returns The section.
 */
export function SceneDetails(props: SceneDetailsProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const open = mission.sceneOpen;
  useRenderView(ctx.state, () => ctx.state.lastFrame);
  return (
    <section
      data-render="scene"
      data-card
      aria-label="Scene details"
      data-open={open ? "" : undefined}
    >
      <h2 data-part="head">
        <button
          type="button"
          data-part="toggle"
          aria-expanded={open}
          aria-controls="render-scene-body"
          onClick={() => {
            mission.sceneOpen = !open;
            notifyMission(mission);
          }}
        >
          <MissionIcon name="chevron" size={14} />
          <span data-part="title">Scene details</span>
          <span data-part="note">render tree, textures, bundles, pools, release log</span>
          <span data-part="meta" data-scene-meta>
            {sceneMeta(ctx)}
          </span>
        </button>
      </h2>
      {open ? <SceneCards {...props} /> : undefined}
    </section>
  );
}
