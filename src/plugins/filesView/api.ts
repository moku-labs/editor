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
 * @example
 * ```ts
 * createToolsPlugin("filesView", { api: createFilesViewApi });
 * ```
 */
export function createFilesViewApi(ctx: FilesViewCtx): FilesViewApi {
  const { state } = ctx;
  return {
    /** @inheritDoc */
    open: (path, options) => openTab(ctx, path, options ?? {}),
    /** @inheritDoc */
    close: (path, options) => closeTab(ctx, path, options?.discard === true),
    /** @inheritDoc */
    activate: path => activateTab(ctx, path),
    /** @inheritDoc */
    tabs: () => state.tabs.map(tab => tabInfo(tab)),
    /** @inheritDoc */
    active: () => state.active,
    /** @inheritDoc */
    edit: (on, path) => setEditing(ctx, on, path),
    /** @inheritDoc */
    setBuffer: (path, text) => setBuffer(ctx, path, text),
    /** @inheritDoc */
    setMode: (path, mode) => setMode(ctx, path, mode),
    /** @inheritDoc */
    save: path => saveTab(ctx, path ?? state.active ?? ""),
    /** @inheritDoc */
    resolveConflict: (path, choice) => resolveConflict(ctx, path, choice),
    /** @inheritDoc */
    refresh: () => buildIndex(ctx),
    /** @inheritDoc */
    files: () => (state.index === undefined ? [] : filesInTreeOrder(state.index)),
    /** @inheritDoc */
    fileOf: ref => nodeFileOf(ref, graphNodeOf(state.graph, ref), state.overrides, existsIn(state)),
    /** @inheritDoc */
    flowFileOf: flow => flowFile(flow, state.overrides, existsIn(state)),
    /** @inheritDoc */
    usedBy: path => state.usedBy?.get(path) ?? UNUSED,
    /** @inheritDoc */
    editorUrl: (path, line) => editorUrlFor(ctx, path, line),
    /** @inheritDoc */
    subscribe: fn => subscribe(state, fn)
  };
}
