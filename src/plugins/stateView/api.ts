/**
 * @file stateView plugin — api factory: lastCommit, note, onCommit, tainted, graph, expanded,
 * setExpanded, expandAll.
 */
import type { StateViewApi, StateViewCtx } from "./types";

/**
 * Creates the stateView api.
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * createStateViewApi(ctx).expandAll("player", true);
 * ```
 */
export function createStateViewApi(_ctx: StateViewCtx): StateViewApi {
  throw new Error("not implemented");
}
