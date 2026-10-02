/**
 * @file workspace plugin — state factory (MinimalContext: no DOM, no storage).
 */
import type { WorkspaceConfig, WorkspaceState } from "./types";

/**
 * Creates the initial workspace state: defaults, empty maps, the UiStore.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createWorkspaceState({ config }).active; // "flow"
 * ```
 */
export function createWorkspaceState(_ctx: {
  readonly config: Readonly<WorkspaceConfig>;
}): WorkspaceState {
  throw new Error("not implemented");
}
