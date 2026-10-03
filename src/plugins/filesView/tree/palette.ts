/**
 * @file filesView plugin — the Files group of the ⌘K palette: one item per indexed file,
 * replaced after every index build; ⇧↵ opens the file in the editor.
 */
import { workspacePlugin } from "../../workspace";
import type { PaletteItem } from "../../workspace/types";
import { editorUrlFor } from "../links/editor-link";
import { openOrLog } from "../tabs/open";
import type { FilesViewCtx } from "../types";
import { filesInTreeOrder, nameOf } from "./model";

/**
 * Opens a URL the browser hands to another app (vscode://…) by clicking a detached link.
 *
 * @param url - The link.
 * @example
 * ```ts
 * openExternal("vscode://file/Users/moku/game/nodes/merge.ts:1");
 * ```
 */
export function openExternal(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.click();
}

/**
 * The palette item of a file: opens it in Files; the alternate action opens it in the editor
 * (absent without boot data).
 *
 * @param ctx - Domain context of filesView.
 * @param path - Relative file path.
 * @returns The item.
 * @example
 * ```ts
 * workspace.palette.add(paletteItemOf(ctx, "nodes/merge.ts"));
 * ```
 */
export function paletteItemOf(ctx: FilesViewCtx, path: string): PaletteItem {
  const url = editorUrlFor(ctx, path);
  const item: PaletteItem = {
    id: `file:${path}`,
    group: "Files",
    label: path,
    mono: true,
    keywords: nameOf(path),
    /**
     * Opens the file in Files.
     *
     * @example
     * ```ts
     * item.run(); // Files shows nodes/merge.ts
     * ```
     */
    run() {
      openOrLog(ctx, path, {});
    }
  };
  if (url !== undefined) {
    item.alt = {
      label: "Open in editor",
      /**
       * Opens the file in the configured editor.
       *
       * @example
       * ```ts
       * item.alt?.run(); // vscode://file/…/nodes/merge.ts:1
       * ```
       */
      run() {
        openExternal(url);
      }
    };
  }
  return item;
}

/**
 * Replaces the Files items of the palette with one item per indexed file (the previous remover
 * runs first). Nothing before the first index.
 *
 * @param ctx - Domain context of filesView.
 * @example
 * ```ts
 * ctx.state.index = index;
 * replacePaletteItems(ctx);
 * ```
 */
export function replacePaletteItems(ctx: FilesViewCtx): void {
  const { state } = ctx;
  if (state.index === undefined) return;

  state.paletteRemover?.();
  const items = filesInTreeOrder(state.index).map(entry => paletteItemOf(ctx, entry.path));
  state.paletteRemover = ctx.require(workspacePlugin).palette.add(items);
}
