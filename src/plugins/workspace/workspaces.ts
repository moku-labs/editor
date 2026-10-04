/**
 * @file workspace plugin — the five workspaces with a pinned preview and the guards that check
 * unknown input (URL hash, stored prefs, api calls). The ids in rail order and their labels live
 * in panels/shared/workspaces.ts, shared with panels.
 */
import { WORKSPACE_IDS } from "../panels/shared/workspaces";
import type { PreviewWorkspace, WorkspaceId } from "./types";

/**
 * The ids as a set of unknown values, for the guard.
 */
const ID_SET: ReadonlySet<unknown> = new Set(WORKSPACE_IDS);

/**
 * The workspaces that carry a pinned game preview (every one but Game).
 *
 * @example
 * ```ts
 * PREVIEW_WORKSPACES.includes("render"); // true
 * ```
 */
export const PREVIEW_WORKSPACES: readonly PreviewWorkspace[] = [
  "flow",
  "render",
  "state",
  "files",
  "console"
];

/**
 * True for one of the six workspace ids.
 *
 * @param value - Anything (a hash, a stored value, an api argument).
 * @returns Whether it is a WorkspaceId.
 * @example
 * ```ts
 * isWorkspaceId(location.hash.slice(1));
 * ```
 */
export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return ID_SET.has(value);
}

/**
 * True for a workspace with a pinned preview.
 *
 * @param ws - A workspace id.
 * @returns Whether it is not Game.
 * @example
 * ```ts
 * isPreviewWorkspace("flow"); // true
 * isPreviewWorkspace("game"); // false
 * ```
 */
export function isPreviewWorkspace(ws: WorkspaceId): ws is PreviewWorkspace {
  return ws !== "game";
}
