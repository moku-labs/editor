/**
 * @file files plugin — state factory.
 */
import type { FilesState } from "./types";

/**
 * Creates the initial files state: no root yet, no compiled globs, no locks. onInit fills the root
 * and the globs.
 *
 * @returns A fresh state.
 */
export function createFilesState(): FilesState {
  return { rootReal: "", allowGlobs: [], denyGlobs: [], locks: new Map() };
}
