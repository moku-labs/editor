/**
 * @file Shared view module — the six workspaces: their ids in rail order (Game first) and their
 * labels. They live in workspace/ids.ts (panels depends on workspace); this module re-exports them
 * so panels and the views import them from the shared folder.
 */
export { WORKSPACE_IDS, WORKSPACE_LABELS } from "../../workspace/ids";
