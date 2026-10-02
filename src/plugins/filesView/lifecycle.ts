/**
 * @file filesView plugin — onInit (register the Files panel, ⌘S, the fileEdit Esc layer; no I/O),
 * onStart (manifest listener, index build not awaited, beforeunload guard) and onStop (removers).
 */
import type { FilesViewCtx, FilesViewState } from "./types";

/**
 * onInit: panels.register(createFilesPanel(ctx)), the ⌘S binding and the fileEdit Esc layer.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onInit: initFilesView });
 * ```
 */
export function initFilesView(_ctx: FilesViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: link.onManifest → loadGraph; buildIndex (not awaited); the beforeunload listener.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onStart: startFilesView });
 * ```
 */
export function startFilesView(_ctx: FilesViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: runs every remover and the palette remover, clears the listeners.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onStop: stopFilesView });
 * ```
 */
export function stopFilesView(_ctx: { readonly state: FilesViewState }): void {
  throw new Error("not implemented");
}
