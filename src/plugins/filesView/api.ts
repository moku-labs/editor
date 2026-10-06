/**
 * @file filesView plugin — api factory: composes the tree, tabs, links and store modules. The
 * contract of every member lives on `FilesViewApi` in types.ts.
 */
import { linkPlugin } from "../link";
import { firstDefinition } from "../registry/protocol";
import { editorUrlFor } from "./links/editor-link";
import { usedByOf } from "./links/used-by";
import { subscribe } from "./store";
import { setBuffer, setEditing, setMode } from "./tabs/edit";
import { tabInfo } from "./tabs/model";
import { activateTab, closeTab, openTab } from "./tabs/open";
import { resolveConflict, saveTab } from "./tabs/save";
import { filesInTreeOrder } from "./tree/model";
import { buildIndex } from "./tree/walk";
import type { FilesViewApi, FilesViewCtx } from "./types";

/**
 * Creates the filesView api over the plugin state (all state lives in `ctx.state`, so the panel
 * and the app share one api surface).
 *
 * @param ctx - Domain context of filesView.
 * @returns The FilesViewApi (`app.filesView`).
 */
export function createFilesViewApi(ctx: FilesViewCtx): FilesViewApi {
  const { state } = ctx;

  /**
   * The newest project state link holds: every lookup asks it again, so a move is seen at once.
   *
   * @returns The project state, or undefined before the first.
   */
  const project = () => ctx.require(linkPlugin).project();

  return {
    open: (path, options) => openTab(ctx, path, options ?? {}),
    close: (path, options) => closeTab(ctx, path, options?.discard === true),
    activate: path => activateTab(ctx, path),
    tabs: () => state.tabs.map(tab => tabInfo(tab)),
    active: () => state.active,
    edit: (on, path) => setEditing(ctx, on, path),
    setBuffer: (path, text) => setBuffer(ctx, path, text),
    setMode: (path, mode) => setMode(ctx, path, mode),
    save: path => saveTab(ctx, path ?? state.active ?? ""),
    resolveConflict: (path, choice) => resolveConflict(ctx, path, choice),
    refresh: () => buildIndex(ctx),
    files: () => (state.index === undefined ? [] : filesInTreeOrder(state.index)),
    fileOf: ref => firstDefinition(project(), `node:${ref.flow}/${ref.node}`),
    flowFileOf: flow => firstDefinition(project(), `flow:${flow}`),
    usedBy: path => usedByOf(project(), path),
    editorUrl: (path, line) => editorUrlFor(ctx, path, line),
    subscribe: fn => subscribe(state, fn)
  };
}
