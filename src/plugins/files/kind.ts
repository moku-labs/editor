/**
 * @file files plugin — classifyWrite: the `kind` of a `files:written` event, from the path.
 */
import type { WrittenKind } from "./types";

/**
 * Classifies a written path: capture, note, layout, style, code, other (first match wins).
 *
 * @param _path - Relative posix path.
 * @example
 * ```ts
 * classifyWrite("features/ui/styles.ts"); // "style"
 * ```
 */
export function classifyWrite(_path: string): WrittenKind {
  throw new Error("not implemented");
}
