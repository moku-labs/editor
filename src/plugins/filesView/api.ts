/**
 * @file filesView plugin — api factory: composes the tree, tabs, links and store modules. The
 * contract of every member lives on `FilesViewApi` in types.ts.
 */
import { flowFile } from "../registry/protocol";
import { editorUrlFor } from "./links/editor-link";
import { existsIn, graphNodeOf, nodeFileOf } from "./links/used-by";
import { subscribe } from "./store";
import { setBuffer, setEditing, setMode } from "./tabs/edit";
import { tabInfo } from "./tabs/model";
import { activateTab, closeTab, openTab } from "./tabs/open";
import { resolveConflict, saveTab } from "./tabs/save";
import { filesInTreeOrder } from "./tree/model";
import { buildIndex } from "./tree/walk";
import type { FilesViewApi, FilesViewCtx, UsedBy } from "./types";

/**
 * Used by of a path that no flow or node uses.
 */
const UNUSED: UsedBy = Object.freeze({ flows: [], nodes: [] });

/**
 * Creates the filesView api over the plugin state (all state lives in `ctx.state`, so the panel
 * and the app share one api surface).
 *
 * @param ctx - Domain context of filesView.
 * @returns The FilesViewApi (`app.filesView`).
 */
export function createFilesViewApi(ctx: FilesViewCtx): FilesViewApi {
  const { state } = ctx;
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
    fileOf: ref => nodeFileOf(ref, graphNodeOf(state.graph, ref), state.overrides, existsIn(state)),
    flowFileOf: flow => flowFile(flow, state.overrides, existsIn(state)),
    usedBy: path => state.usedBy?.get(path) ?? UNUSED,
    editorUrl: (path, line) => editorUrlFor(ctx, path, line),
    subscribe: fn => subscribe(state, fn)
  };
}
