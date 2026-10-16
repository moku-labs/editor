/**
 * @file renderView components (connection) — the connection bar over both columns (spec 09 § M7):
 * the source stripe (the `--src` tint of the workspace), the source pill with its health line, the
 * facts row, and the action row (the paused chip and the actions with their popovers). The bar is
 * marked stale while the link is silent or lost.
 */
import type { JSX } from "preact";
import type { LinkStatus } from "../../../registry/protocol";
import type { WorkspaceApi } from "../../../workspace/types";
import type { RenderViewCtx } from "../../types";
import { Actions } from "./Actions";
import { Facts } from "./Facts";
import { PausedChip } from "./PausedChip";
import { SourcePill } from "./SourcePill";

/**
 * Props of `ConnectionBar`.
 */
export type ConnectionBarProps = {
  readonly ctx: RenderViewCtx;
  readonly status: LinkStatus;
  readonly workspace: WorkspaceApi;
};

/**
 * The connection bar.
 *
 * @param props - ctx, the link status of this render and the workspace api.
 * @returns The bar.
 */
export function ConnectionBar(props: ConnectionBarProps): JSX.Element {
  const { ctx, status } = props;
  const stale = status.kind === "silent" || status.kind === "lost";
  return (
    <section
      data-render="connection"
      aria-label="Connected source"
      data-stale={stale ? "" : undefined}
    >
      <SourcePill ctx={ctx} status={status} />
      <div data-part="main">
        <Facts ctx={ctx} />
        <div data-part="actions-row">
          <PausedChip ctx={ctx} />
          <Actions ctx={ctx} />
        </div>
      </div>
    </section>
  );
}
