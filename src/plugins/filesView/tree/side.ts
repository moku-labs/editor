/**
 * @file filesView plugin — the tree's side panel (finding 2, D-29): its SidePanel id and sizes,
 * the `\` binding that collapses or expands it, the palette item that shows it again after a
 * close, and the shut of its drawer after a file pick at a narrow width.
 */
import { showSidePanel, sidePanelState, toggleSidePanel } from "../../panels/shared/side-panel";
import { workspacePlugin } from "../../workspace";
import type { KeyBinding, PaletteItem } from "../../workspace/types";
import type { FilesViewCtx } from "../types";

/**
 * The SidePanel id of the tree: the localStorage key `moku-editor:panel:files.tree`.
 */
export const TREE_PANEL = "files.tree";

/**
 * The sizes of the tree panel in px, and the Files container width below which it floats over
 * the editor as a drawer.
 */
export const TREE_SIZE = { defaultWidth: 272, minWidth: 200, maxWidth: 480, overlayBelow: 600 };

/**
 * The `\` binding: Files only, not in inputs; collapses or expands the tree (shows it when
 * closed, opens or shuts the drawer when it floats).
 *
 * @returns The binding.
 * @example
 * ```ts
 * workspace.keys.bind(treeToggleBinding());
 * ```
 */
export function treeToggleBinding(): KeyBinding {
  return {
    keys: "\\",
    label: "Collapse or expand the Files tree",
    workspace: "files",
    /**
     * Toggles the tree panel.
     */
    run: () => {
      toggleSidePanel(TREE_PANEL);
    }
  };
}

/**
 * The palette item "Show Files tree": shows Files and the tree expanded (open again after a
 * close, the drawer open when it floats).
 *
 * @param ctx - Domain context of filesView.
 * @returns The item.
 */
export function showTreeItem(ctx: FilesViewCtx): PaletteItem {
  return {
    id: "files:show-tree",
    group: "Commands",
    label: "Show Files tree",
    shortcut: "\\",
    /**
     * Shows the Files workspace and the tree.
     */
    run() {
      ctx.require(workspacePlugin).show("files");
      showSidePanel(TREE_PANEL);
    }
  };
}

/**
 * Shuts the tree's drawer when it floats open over the editor, so the file just picked shows.
 * Nothing while the tree is docked.
 *
 * @example
 * ```ts
 * openOrLog(ctx, row.path, {});
 * shutTreeDrawer();
 * ```
 */
export function shutTreeDrawer(): void {
  const state = sidePanelState(TREE_PANEL);
  if (state.overlay && state.drawer) toggleSidePanel(TREE_PANEL);
}
