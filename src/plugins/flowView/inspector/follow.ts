/**
 * @file flowView inspector module — what a project index change (link:project, D-46) asks of the
 * inspector: which node the Code tab reads again. Pure.
 */
import type { ProjectDelta } from "../../registry/protocol";
import type { NodeId } from "../types";
import type { InspectorState } from "./types";

/**
 * True when a delta touches a file: everything after a revision gap, or the file was edited,
 * removed or moved away.
 *
 * @param delta - What the index changed.
 * @param path - A root-relative file; undefined touches only on a gap.
 * @returns Whether a view showing `path` reads it again.
 * @example
 * ```ts
 * touches({ all: false, files: [], removed: [], moved: [{ key: "node:board/merge", from: "nodes/merge.ts", to: "nodes/board/merge.ts" }] }, "nodes/merge.ts"); // true
 * touches({ all: false, files: ["nodes/toast.ts"], removed: [], moved: [] }, "nodes/merge.ts"); // false
 * ```
 */
export function touches(delta: ProjectDelta, path: string | undefined): boolean {
  if (delta.all) return true;
  if (path === undefined) return false;

  return (
    delta.files.includes(path) ||
    delta.removed.includes(path) ||
    delta.moved.some(move => move.from === path)
  );
}

/**
 * The node the Code tab reads again after a change: only on the Code tab, never over a draft. A
 * tab that shows a note (index off, key unknown) asks on every change; a tab with code only when
 * the change touches its file.
 *
 * @param inspector - The inspector slice.
 * @param delta - What the index changed.
 * @returns The node id, or undefined when the tab stays.
 * @example
 * ```ts
 * // The Code tab shows nodes/merge.ts and an agent edited it.
 * codeToFollow(inspector, { all: false, files: ["nodes/merge.ts"], moved: [], removed: [] }); // "board/merge"
 * ```
 */
export function codeToFollow(
  inspector: Pick<InspectorState, "tab" | "code" | "codeNode">,
  delta: ProjectDelta
): NodeId | undefined {
  const { tab, code, codeNode } = inspector;
  const isCodeTabFree = tab === "code" && codeNode !== undefined && code?.draft === undefined;
  if (!isCodeTabFree) return undefined;
  if (code !== undefined && !touches(delta, code.path)) return undefined;

  return codeNode;
}
