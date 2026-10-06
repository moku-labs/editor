/**
 * @file filesView plugin — state factory.
 */
import type { FilesViewState } from "./types";

/**
 * Creates the initial filesView state: empty collections, nothing indexed, no graph, no tab,
 * no project delta in flight.
 *
 * @returns A fresh state.
 */
export function createFilesViewState(): FilesViewState {
  return {
    index: undefined,
    indexing: undefined,
    indexDirty: false,
    expanded: new Set(),
    tabs: [],
    active: undefined,
    graph: undefined,
    confirmClose: undefined,
    following: undefined,
    listeners: new Set(),
    removers: [],
    paletteRemover: undefined
  };
}
