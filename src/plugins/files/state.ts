/**
 * @file files plugin — state factory.
 */
import type { FilesState } from "./types";

/**
 * Creates the initial files state: no root yet, no compiled globs, no locks, the project index
 * not opened. onInit fills the root and the globs; onStart opens the index.
 *
 * @returns A fresh state.
 */
export function createFilesState(): FilesState {
  return {
    rootReal: "",
    allowGlobs: [],
    denyGlobs: [],
    locks: new Map(),
    project: undefined,
    opening: undefined,
    projectState: { state: "off", reason: "not opened" },
    stopWatch: undefined,
    stopped: false
  };
}
