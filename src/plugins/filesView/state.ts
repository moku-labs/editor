/**
 * @file filesView plugin — state factory.
 */
import type { FilesViewState } from "./types";

/**
 * Creates the initial filesView state: empty collections, overrides `{}`, nothing indexed,
 * no graph, no tab.
 *
 * @returns A fresh state.
 * @example
 * ```ts
 * createFilesViewState().tabs; // []
 * ```
 */
export function createFilesViewState(): FilesViewState {
  return {
    index: undefined,
    indexing: undefined,
    expanded: new Set(),
    tabs: [],
    active: undefined,
    graph: undefined,
    overrides: {},
    usedBy: undefined,
    confirmClose: undefined,
    listeners: new Set(),
    removers: [],
    paletteRemover: undefined
  };
}
