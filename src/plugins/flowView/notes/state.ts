/**
 * @file flowView notes module — state factory.
 */
import type { NotesState } from "./types";

/**
 * Creates the notes slice: no files, not loaded, editor closed.
 *
 * @example
 * ```ts
 * createNotesState().loaded; // false
 * ```
 */
export function createNotesState(): NotesState {
  throw new Error("not implemented");
}
