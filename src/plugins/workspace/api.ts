/**
 * @file workspace plugin — api factory: composes the sub-module functions.
 */
import type { WorkspaceApi, WorkspaceCtx } from "./types";

/**
 * Creates the workspace api.
 *
 * @param _ctx - Domain context of workspace.
 * @example
 * ```ts
 * createWorkspaceApi(ctx).show("game");
 * ```
 */
export function createWorkspaceApi(_ctx: WorkspaceCtx): WorkspaceApi {
  throw new Error("not implemented");
}
