/**
 * @file filesView plugin — the project tree: header "Project · N files" with Refresh, rows with
 * twisty, kind glyph and name (folders first), the empty captures note, the loading and failure
 * lines. ARIA tree with roving tabindex: ↑/↓, → opens or enters, ← closes or goes up, Enter or
 * Space opens, Home/End.
 */
import type { VNode } from "preact";
import { Fragment } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { notify } from "../store";
import { extensionOf, IMAGE_EXTENSIONS } from "../tabs/kind";
import { openOrLog } from "../tabs/open";
import { countFiles, parentOf, toggleFolder, visibleRows } from "../tree/model";
import { shutTreeDrawer } from "../tree/side";
import type { FileIndex, FilesViewApi, FilesViewCtx, TreeRow } from "../types";
import { useElement } from "./useFiles";

/**
 * The folder whose empty state names the Game camera.
 */
const CAPTURES_DIR = ".moku/captures";

/**
 * Whether a row is the open captures folder with nothing in it (it shows the camera note).
 *
 * @param row - The tree row.
 * @param index - The file index.
 * @returns True for an expanded, empty captures folder.
 */
function showsEmptyCaptures(row: TreeRow, index: FileIndex): boolean {
  return row.path === CAPTURES_DIR && row.expanded && index.children.get(row.path)?.length === 0;
}

/**
 * Glyph names by extension (the CSS draws them).
 */
const GLYPHS: Readonly<Record<string, string>> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "ts",
  ".jsx": "ts",
  ".mjs": "ts",
  ".cjs": "ts",
  ".css": "css",
  ".json": "json",
  ".md": "md"
};

/**
 * Props of `Tree`.
 */
export type TreeProps = { readonly ctx: FilesViewCtx; readonly api: FilesViewApi };

/**
 * The glyph of a row: folder, ts, css, json, md, image or file.
 *
 * @param row - A tree row.
 * @returns The glyph name.
 * @example
 * ```ts
 * glyphOf({ path: "nodes/merge.ts", name: "merge.ts", kind: "file", level: 2, expanded: false }); // "ts"
 * ```
 */
function glyphOf(row: TreeRow): string {
  if (row.kind === "dir") return "folder";
  const extension = extensionOf(row.path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return GLYPHS[extension] ?? "file";
}

/**
 * The twisty of a row: ▾ open folder, ▸ closed folder, nothing for a file.
 *
 * @param row - A tree row.
 * @returns The twisty character.
 * @example
 * ```ts
 * twistyOf({ path: "flows", name: "flows", kind: "dir", level: 1, expanded: true }); // "▾"
 * ```
 */
function twistyOf(row: TreeRow): string {
  if (row.kind === "file") return "";
  return row.expanded ? "▾" : "▸";
}

/**
 * The header count: "24 files", "1 file", "5000+ files".
 *
 * @param count - Indexed files.
 * @param truncated - Whether the walk hit maxFiles.
 * @returns The count text.
 * @example
 * ```ts
 * countText(5000, true); // "5000+ files"
 * ```
 */
function countText(count: number, truncated: boolean): string {
  return `${count}${truncated ? "+" : ""} ${count === 1 && !truncated ? "file" : "files"}`;
}

/**
 * The row the key moves to, or undefined when the key does not move.
 *
 * @param rows - Visible rows.
 * @param position - The focused row's index.
 * @param key - The key.
 * @returns The target row index.
 * @example
 * ```ts
 * moveTo(rows, 0, "ArrowDown"); // 1
 * ```
 */
function moveTo(rows: readonly TreeRow[], position: number, key: string): number | undefined {
  if (key === "ArrowDown") return Math.min(rows.length - 1, position + 1);
  if (key === "ArrowUp") return Math.max(0, position - 1);
  if (key === "Home") return 0;
  if (key === "End") return rows.length - 1;
  return undefined;
}

/**
 * What a key on a focused row does: focus another row, activate this one (open the file or
 * toggle the folder), or nothing while still consuming the key.
 */
type RowKeyAction =
  | { readonly kind: "focus"; readonly path: string }
  | { readonly kind: "activate" }
  | { readonly kind: "stay" };

/** Activate the focused row. */
const ACTIVATE: RowKeyAction = { kind: "activate" };

/** Consume the key without a change. */
const STAY: RowKeyAction = { kind: "stay" };

/**
 * ArrowRight on a folder: a closed folder opens, an open one moves to its first child.
 *
 * @param rows - The visible rows.
 * @param position - Index of the folder.
 * @param row - The folder.
 * @returns The action.
 * @example
 * ```ts
 * enterFolder(rows, 0, { path: "flows", name: "flows", kind: "dir", level: 1, expanded: false }); // { kind: "activate" }
 * ```
 */
function enterFolder(rows: readonly TreeRow[], position: number, row: TreeRow): RowKeyAction {
  if (!row.expanded) return ACTIVATE;
  const next = rows[position + 1];
  const hasChildShown = next !== undefined && next.level > row.level;
  return hasChildShown ? { kind: "focus", path: next.path } : STAY;
}

/**
 * ArrowLeft: an open folder closes, any other row moves to its parent folder.
 *
 * @param row - The focused row.
 * @returns The action.
 * @example
 * ```ts
 * leaveRow({ path: "nodes/merge.ts", name: "merge.ts", kind: "file", level: 2, expanded: false }); // { kind: "focus", path: "nodes" }
 * ```
 */
function leaveRow(row: TreeRow): RowKeyAction {
  if (row.kind === "dir" && row.expanded) return ACTIVATE;
  const parent = parentOf(row.path);
  return parent === "" ? STAY : { kind: "focus", path: parent };
}

/**
 * The action of a key on a focused row (WAI-ARIA tree keys).
 *
 * @param rows - The visible rows.
 * @param position - Index of the row.
 * @param row - The row.
 * @param key - `KeyboardEvent.key`.
 * @returns The action, undefined when the tree does not handle the key.
 * @example
 * ```ts
 * rowKeyAction(rows, 0, rows[0], "Enter"); // { kind: "activate" }
 * ```
 */
function rowKeyAction(
  rows: readonly TreeRow[],
  position: number,
  row: TreeRow,
  key: string
): RowKeyAction | undefined {
  const target = moveTo(rows, position, key);
  if (target !== undefined) return { kind: "focus", path: rows[target]?.path ?? row.path };
  if (key === "Enter" || key === " ") return ACTIVATE;
  if (key === "ArrowRight" && row.kind === "dir") return enterFolder(rows, position, row);
  if (key === "ArrowLeft") return leaveRow(row);
  return undefined;
}

/**
 * The project tree.
 *
 * @param props - Context and api.
 * @returns The tree region.
 */
export function Tree(props: TreeProps): VNode {
  const { ctx, api } = props;
  const { state } = ctx;
  const [focused, setFocused] = useState<string | undefined>();
  const [pendingFocus, setPendingFocus] = useState<string | undefined>();
  const tree = useElement<HTMLElement>();
  const index = state.index;
  const rows = index === undefined ? [] : visibleRows(index, state.expanded);
  const current = rows.find(row => row.path === focused)?.path ?? state.active ?? rows[0]?.path;
  const tabStop = rows.some(row => row.path === current) ? current : rows[0]?.path;

  // A layout effect: the row takes focus in the same commit that shows it, before the next event,
  // so a later click or programmatic focus elsewhere is never taken back by a stale request.
  useLayoutEffect(() => {
    if (pendingFocus === undefined) return;
    const items = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const item of items) if (item.dataset.path === pendingFocus) item.focus();
    // A key pressed before this effect ran asked for a newer row: keep that request.
    setPendingFocus(current => (current === pendingFocus ? undefined : current));
  }, [pendingFocus, tree]);

  /**
   * Focuses a row (after the render that shows it).
   *
   * @param path - The row's path.
   */
  const focusRow = (path: string): void => {
    setFocused(path);
    setPendingFocus(path);
  };

  /**
   * Opens a file (and shuts the tree's drawer when it floats) or toggles a folder.
   *
   * @param row - The row.
   */
  const activate = (row: TreeRow): void => {
    focusRow(row.path);
    if (row.kind === "file") {
      openOrLog(ctx, row.path, {});
      shutTreeDrawer();
      return;
    }
    toggleFolder(state.expanded, row.path);
    notify(state);
  };

  /**
   * The keys of a focused row.
   *
   * @param row - The row.
   * @param position - Its index.
   * @param event - The key event.
   */
  const onRowKey = (row: TreeRow, position: number, event: KeyboardEvent): void => {
    const action = rowKeyAction(rows, position, row, event.key);
    if (action === undefined) return;
    if (action.kind === "focus") focusRow(action.path);
    if (action.kind === "activate") activate(row);
    event.preventDefault();
  };

  return (
    <nav data-part="tree" aria-label="Project">
      <header data-tree-head>
        <span>
          Project · {index === undefined ? "…" : countText(countFiles(index), index.truncated)}
        </span>
        <button
          type="button"
          data-variant="ghost"
          aria-label="Refresh the file list"
          title="Refresh the file list"
          onClick={() => {
            api.refresh();
          }}
        >
          ↻
        </button>
      </header>
      {index === undefined && state.indexing !== undefined && (
        <p data-tree-state="loading" role="status">
          Loading the file list…
        </p>
      )}
      {index === undefined && state.indexing === undefined && (
        <p data-tree-state="failed" role="alert">
          The file list is not available ·{" "}
          <button
            type="button"
            data-link
            onClick={() => {
              api.refresh();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {index !== undefined && (
        <div role="tree" aria-label="Project files" ref={tree.ref}>
          {rows.map((row, position) => (
            <Fragment key={row.path}>
              <div
                role="treeitem"
                data-path={row.path}
                data-kind={row.kind}
                aria-level={row.level}
                aria-expanded={row.kind === "dir" ? row.expanded : undefined}
                aria-selected={row.path === state.active}
                tabIndex={row.path === tabStop ? 0 : -1}
                style={{ "--level": row.level }}
                onClick={() => activate(row)}
                onKeyDown={event => onRowKey(row, position, event)}
              >
                <span data-twisty aria-hidden="true">
                  {twistyOf(row)}
                </span>
                <span data-glyph={glyphOf(row)} aria-hidden="true" />
                <span data-name>{row.name}</span>
              </div>
              {showsEmptyCaptures(row, index) && (
                <div
                  role="treeitem"
                  aria-level={row.level + 1}
                  aria-disabled="true"
                  aria-selected={false}
                  tabIndex={-1}
                  data-tree-note
                  style={{ "--level": row.level + 1 }}
                >
                  No captures yet · camera in Game
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </nav>
  );
}
