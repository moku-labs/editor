/**
 * @file renderView plugin — the Render workspace (design A3): the title with the frame, six metric
 * tiles, the left column (render tree, textures) and the right column (bundles, pools, release
 * log). Re-renders on every notify; marks stale data while the link is silent or lost.
 */
import type { JSX } from "preact";
import type { LinkStatus } from "../../registry/protocol";
import type { WorkspaceApi } from "../../workspace/types";
import { deriveSnapshot } from "../derive";
import { tileViews } from "../format";
import type { RenderViewCtx } from "../types";
import { BundlesCard } from "./BundlesCard";
import { MetricTile } from "./MetricTile";
import { PoolsCard } from "./PoolsCard";
import { ReleaseLogCard } from "./ReleaseLogCard";
import { RenderTreeCard } from "./RenderTreeCard";
import { Sparkline } from "./Sparkline";
import { TexturesCard } from "./TexturesCard";
import { useRenderView } from "./useRenderView";

/**
 * The frame budget the frame-time bar is drawn against (60 fps).
 */
const FRAME_BUDGET_MS = 1000 / 60;

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
 * @example
 * ```tsx
 * <RenderWorkspace ctx={ctx} status={tools.status} workspace={tools.workspace} />
 * ```
 */
export function RenderWorkspace(props: RenderWorkspaceProps): JSX.Element {
  const { ctx, status, workspace } = props;
  const snapshot = useRenderView(ctx.state, () => deriveSnapshot(ctx.state));
  const stale = status.kind === "silent" || status.kind === "lost";
  const { fps, frameMs } = snapshot.tiles;

  return (
    <div data-render="workspace" data-stale={stale ? "" : undefined}>
      <h1>Render · game.render · frame {snapshot.frame ?? "—"}</h1>
      {ctx.state.error === undefined ? undefined : (
        <p role="status" data-error>
          {ctx.state.error}
        </p>
      )}
      <div data-render="tiles">
        {tileViews(snapshot.tiles).map(view => (
          <MetricTile key={view.id} view={view}>
            {view.id === "fps" && fps !== undefined ? (
              <Sparkline samples={fps.samples} />
            ) : undefined}
            {view.id === "frame" && frameMs !== undefined ? (
              <span data-bar>
                <span
                  data-phase="1"
                  style={{
                    inlineSize: `${Math.min(100, Math.round((frameMs / FRAME_BUDGET_MS) * 100))}%`
                  }}
                />
              </span>
            ) : undefined}
          </MetricTile>
        ))}
      </div>
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
