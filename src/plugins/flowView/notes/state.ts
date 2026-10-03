/**
 * @file flowView notes module — state factory.
 */
import type { NotesState } from "./types";

/**
 * Creates the notes slice: no files, not loaded, editor closed.
 *
 * @returns The notes state.
 * @example
 * ```ts
 * createNotesState().loaded; // false
 * ```
 */
export function createNotesState(): NotesState {
  return { files: [], loaded: false, editor: undefined };
}
