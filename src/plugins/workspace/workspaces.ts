/**
 * @file workspace plugin — the six workspaces: ids in rail order, the five with a pinned preview,
 * their labels and the guards that check unknown input (URL hash, stored prefs, api calls).
 */
import type { PreviewWorkspace, WorkspaceId } from "./types";

/**
 * The six workspaces in rail order (⌘1–⌘6).
 *
 * @example
 * ```ts
 * WORKSPACE_IDS.indexOf("game"); // 1
 * ```
 */
export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  "flow",
  "game",
  "render",
  "state",
  "files",
  "console"
];

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
 * The label of each workspace, shown in the rail, the hosts and the toasts.
 *
 * @example
 * ```ts
 * WORKSPACE_LABELS.console; // "Console"
 * ```
 */
export const WORKSPACE_LABELS: Readonly<Record<WorkspaceId, string>> = {
  flow: "Flow",
  game: "Game",
  render: "Render",
  state: "State",
  files: "Files",
  console: "Console"
};

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
