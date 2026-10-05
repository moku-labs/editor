/**
 * @file workspace plugin — the six workspaces: their ids in rail order (Game first) and their
 * labels. Plain data, used by workspace (rail, hosts, palette, keys, prefs) and re-exported by
 * panels/shared/workspaces.ts for panels (the palette item of a panel).
 */
import type { WorkspaceId } from "./types";

/**
 * The six workspaces in rail order (⌘1–⌘6): Game first, then Flow.
 *
 * @example
 * ```ts
 * WORKSPACE_IDS.indexOf("game"); // 0
 * ```
 */
export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  "game",
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
