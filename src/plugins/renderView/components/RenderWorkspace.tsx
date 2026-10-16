/**
 * @file renderView plugin — the Render workspace. Skeleton of build wave 0 (spec 09 § M17, RV0): the
 * title with the frame and the scene cards, the left column (render tree, textures) and the right
 * column (bundles, pools, release log); Mission control (the connection bar, the instrument, the
 * cards and the inspector, with the scene cards in "Scene details") arrives in build wave 4 (RV5,
 * RV6). Re-renders on every notify;
 * marks stale data while the link is silent or lost.
 */
import type { JSX } from "preact";
import type { LinkStatus } from "../../registry/protocol";
import type { WorkspaceApi } from "../../workspace/types";
import { deriveSnapshot } from "../derive";
import type { RenderViewCtx } from "../types";
import { BundlesCard } from "./BundlesCard";
import { PoolsCard } from "./PoolsCard";
import { ReleaseLogCard } from "./ReleaseLogCard";
import { RenderTreeCard } from "./RenderTreeCard";
import { TexturesCard } from "./TexturesCard";
import { useRenderView } from "./useRenderView";

/**
 * Props of `RenderWorkspace`.
 */
export type RenderWorkspaceProps = {
  readonly ctx: RenderViewCtx;
  readonly status: LinkStatus;
  readonly workspace: WorkspaceApi;
};

/**
 * The Render workspace.
 *
 * @param props - ctx, the link status of this render and the workspace api.
 * @returns The workspace.
 */
export function RenderWorkspace(props: RenderWorkspaceProps): JSX.Element {
  const { ctx, status, workspace } = props;
  const snapshot = useRenderView(ctx.state, () => deriveSnapshot(ctx.state));
  const stale = status.kind === "silent" || status.kind === "lost";

  return (
    <div data-render="workspace" data-stale={stale ? "" : undefined}>
      <h1>Render · game.render · frame {snapshot.frame ?? "—"}</h1>
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
