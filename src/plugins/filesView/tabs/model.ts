/**
 * @file filesView plugin — tab records: a new tab, lookups, the modified rule and the api view.
 */
import type { FilesViewState, OpenTab, TabInfo } from "../types";
import { kindOf } from "./kind";

/**
 * A fresh tab in `loading`: markdown and series start in preview, every other kind in source.
 *
 * @param path - A relative path.
 * @returns The tab.
 * @example
 * ```ts
 * newTab("docs/a.md").mode; // "preview"
 * ```
 */
export function newTab(path: string): OpenTab {
  const kind = kindOf(path);
  return {
    path,
    kind,
    saved: undefined,
    buffer: undefined,
    version: undefined,
    image: undefined,
    status: "loading",
    message: undefined,
    editing: false,
    mode: kind === "markdown" || kind === "series" ? "preview" : "source",
    line: undefined,
    checkedAt: 0
  };
}

/**
 * The open tab of a path.
 *
 * @param state - filesView state.
 * @param path - A relative path.
 * @returns The tab, or undefined.
 */
export function findTab(state: FilesViewState, path: string): OpenTab | undefined {
  return state.tabs.find(tab => tab.path === path);
}

/**
 * The active tab.
 *
 * @param state - filesView state.
 * @returns The tab, or undefined with no tab open.
 */
export function activeTab(state: FilesViewState): OpenTab | undefined {
  return state.active === undefined ? undefined : findTab(state, state.active);
}

/**
 * True when the buffer differs from the text on disk.
 *
 * @param tab - A tab.
 * @returns Whether the tab has unsaved changes.
 * @example
 * ```ts
 * isModified({ ...tab, saved: "a", buffer: "b" }); // true
 * ```
 */
export function isModified(tab: OpenTab): boolean {
  return tab.buffer !== tab.saved;
}

/**
 * The api view of a tab.
 *
 * @param tab - A tab.
 * @returns Its TabInfo.
 * @example
 * ```ts
 * tabInfo(newTab("a.ts")); // { path: "a.ts", kind: "code", modified: false, editing: false, status: "loading" }
 * ```
 */
export function tabInfo(tab: OpenTab): TabInfo {
  return {
    path: tab.path,
    kind: tab.kind,
    modified: isModified(tab),
    editing: tab.editing,
    status: tab.status
  };
}
