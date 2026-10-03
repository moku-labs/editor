/**
 * @file filesView plugin — onInit (register the Files panel, ⌘S, the fileEdit Esc layer; no I/O),
 * onStart (manifest listener, index build not awaited, beforeunload guard) and onStop (removers).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import type { KeyBinding } from "../workspace/types";
import { messageOf } from "./errors";
import { loadGraph } from "./links/used-by";
import { createFilesPanel } from "./panel";
import { closeTopmost } from "./tabs/edit";
import { activeTab, isModified } from "./tabs/model";
import { saveTab } from "./tabs/save";
import { buildIndex } from "./tree/walk";
import type { FilesViewCtx, FilesViewState } from "./types";

/**
 * The ⌘S binding: Files only, also inside the editor's textarea, only while the active tab is
 * in edit mode; saves the active tab.
 *
 * @param ctx - Domain context of filesView.
 * @returns The binding.
 * @example
 * ```ts
 * workspace.keys.bind(saveBinding(ctx));
 * ```
 */
export function saveBinding(ctx: FilesViewCtx): KeyBinding {
  return {
    keys: "mod+s",
    label: "Save file",
    workspace: "files",
    inInputs: true,
    /**
     * Active only while the active tab is in edit mode.
     *
     * @returns Whether ⌘S applies.
     * @example
     * ```ts
     * binding.when?.(); // true while editing
     * ```
     */
    when: () => activeTab(ctx.state)?.editing === true,
    /**
     * Saves the active tab (saveTab never rejects).
     *
     * @example
     * ```ts
     * binding.run(event);
     * ```
     */
    run: () => {
      const path = ctx.state.active;
      if (path !== undefined) void saveTab(ctx, path);
    }
  };
}

/**
 * The beforeunload listener: asks the browser to confirm leaving while a tab is modified.
 *
 * @param state - filesView state.
 * @returns The listener.
 * @example
 * ```ts
 * window.addEventListener("beforeunload", guardUnload(ctx.state));
 * ```
 */
export function guardUnload(state: FilesViewState): (event: Event) => void {
  return event => {
    if (!state.tabs.some(tab => isModified(tab))) return;
    event.preventDefault();
    // Older browsers also need returnValue set to show the prompt.
    Reflect.set(event, "returnValue", "");
  };
}

/**
 * onInit: registers the Files panel, binds ⌘S and the `fileEdit` Esc layer (it acts only while
 * Files is shown, so Esc in another workspace reaches that workspace's layers). No I/O.
 *
 * @param ctx - Domain context of filesView.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onInit: initFilesView });
 * ```
 */
export function initFilesView(ctx: FilesViewCtx): void {
  ctx.require(panelsPlugin).register(createFilesPanel(ctx));
  const workspace = ctx.require(workspacePlugin);
  ctx.state.removers.push(
    workspace.keys.bind(saveBinding(ctx)),
    workspace.keys.escape("fileEdit", () => workspace.active() === "files" && closeTopmost(ctx))
  );
}

/**
 * onStart: loads `game.graph` on every manifest, starts the index build without awaiting it
 * and adds the beforeunload guard. Every remover goes to `state.removers`.
 *
 * @param ctx - Domain context of filesView.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onStart: startFilesView });
 * ```
 */
export function startFilesView(ctx: FilesViewCtx): void {
  const { state } = ctx;
  state.removers.push(
    ctx.require(linkPlugin).onManifest(() => {
      loadGraph(ctx).catch((error: unknown) => {
        ctx.log.warn("filesView:graph-failed", { message: messageOf(error) });
      });
    })
  );
  void buildIndex(ctx);

  if (typeof globalThis.addEventListener === "function") {
    const guard = guardUnload(state);
    globalThis.addEventListener("beforeunload", guard);
    state.removers.push(() => globalThis.removeEventListener("beforeunload", guard));
  }
}

/**
 * onStop: runs every remover and the palette remover, clears the listeners. Teardown context
 * only (spec/08-CONTEXT.md §2).
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { onStop: stopFilesView });
 * ```
 */
export function stopFilesView(ctx: { readonly state: FilesViewState }): void {
  const { state } = ctx;
  for (const remove of state.removers) remove();
  state.removers = [];
  state.paletteRemover?.();
  state.paletteRemover = undefined;
  state.listeners.clear();
}
