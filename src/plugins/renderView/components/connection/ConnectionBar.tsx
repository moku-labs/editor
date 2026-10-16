/**
 * @file renderView components (connection) — The connection bar over both columns (spec 09 §
 * M7): source stripe and pill, health line, facts, the paused chip and the actions. Typed stub
 * of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import type { LinkStatus } from "../../../registry/protocol";
import type { WorkspaceApi } from "../../../workspace/types";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `ConnectionBar`.
 */
export type ConnectionBarProps = {
  readonly ctx: RenderViewCtx;
  readonly status: LinkStatus;
  readonly workspace: WorkspaceApi;
};

/**
 * The connection bar over both columns (spec 09 § M7): source stripe and pill, health line,
 * facts, the paused chip and the actions.
 *
 * @param _props - ctx, the link status of this render and the workspace api.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/ConnectionBar is not built yet".
 */
export function ConnectionBar(_props: ConnectionBarProps): JSX.Element {
  return notBuilt("components/ConnectionBar", 4);
}
