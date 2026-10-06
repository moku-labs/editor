/**
 * @file flowView inspector module — what a project index change (link:project, D-46) asks of the
 * inspector: which node the Code tab reads again, whether the Styles tab reads its file again,
 * and whether the text styles changed. Pure.
 */
import { textStylesFile } from "../../panels/shared/project";
import type { ProjectDelta, ProjectState } from "../../registry/protocol";
import type { NodeId } from "../types";
import type { InspectorState, StylesState } from "./types";

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

/**
 * True when the text styles may have changed: a revision gap, a moved `textStyle:` key, another
 * text-styles file than the one last read, or a change of that file.
 *
 * @param keysFile - The text-styles file the palette group Styles was last read from.
 * @param state - The new project state.
 * @param delta - What the index changed.
 * @returns Whether the Styles group is read again.
 * @example
 * ```ts
 * // An agent added a text style to the styles file.
 * textStylesChanged("features/ui/styles.ts", state, { all: false, files: ["features/ui/styles.ts"], moved: [], removed: [] }); // true
 * ```
 */
export function textStylesChanged(
  keysFile: string | undefined,
  state: ProjectState,
  delta: ProjectDelta
): boolean {
  if (delta.all) return true;
  if (delta.moved.some(move => move.key.startsWith("textStyle:"))) return true;

  const file = textStylesFile(state);
  return file !== keysFile || touches(delta, file);
}

/**
 * True while the Styles tab holds an edit of its own: a stepper burst waiting for its debounce, or
 * its write on the way.
 *
 * @param styles - The Styles tab slice.
 * @returns Whether a project change leaves the tab alone.
 * @example
 * ```ts
 * // The write of a size burst is on the way.
 * isWriting({ pending: undefined, writing: true }); // true
 * // No press waits and no write runs: a project change may read the file again.
 * isWriting({ pending: undefined, writing: false }); // false
 * ```
 */
export function isWriting(styles: Pick<StylesState, "pending" | "writing">): boolean {
  return styles.pending !== undefined || styles.writing;
}

/**
 * True when the Styles tab reads its file again after a change: it was opened and shows no
 * styles (the index was off, had no state yet, named no text-styles file, or the file could not
 * be read), or the index names another text-styles file, or the change touches that file. Never
 * during an edit of its own (a stepper burst or its write).
 *
 * @param inspector - The inspector slice.
 * @param state - The new project state.
 * @param delta - What the index changed.
 * @returns Whether the Styles tab is read again.
 * @example
 * ```ts
 * // The Styles tab opened before the first project state said "Project index is off".
 * stylesToFollow(inspector, state, { all: true, files: [], moved: [], removed: [] }); // true
 * ```
 */
export function stylesToFollow(
  inspector: Pick<InspectorState, "styles">,
  state: ProjectState,
  delta: ProjectDelta
): boolean {
  const { styles } = inspector;
  if (styles === undefined || isWriting(styles)) return false;
  if (styles.file === undefined || styles.error?.error === "no-file") return true;

  return textStylesFile(state) !== styles.file || touches(delta, styles.file);
}
