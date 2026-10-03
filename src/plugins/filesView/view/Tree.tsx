/**
 * @file filesView plugin — the project tree: header "Project · N files" with Refresh, rows with
 * twisty, kind glyph and name (folders first), the empty captures note, the loading and failure
 * lines. ARIA tree with roving tabindex: ↑/↓, → opens or enters, ← closes or goes up, Enter or
 * Space opens, Home/End.
 */
import type { VNode } from "preact";
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { notify } from "../store";
import { extensionOf, IMAGE_EXTENSIONS } from "../tabs/kind";
import { openOrLog } from "../tabs/open";
import { countFiles, parentOf, toggleFolder, visibleRows } from "../tree/model";
import type { FilesViewApi, FilesViewCtx, TreeRow } from "../types";
import { useElement } from "./useFiles";

/**
 * The folder whose empty state names the Game camera.
 */
const CAPTURES_DIR = ".moku/captures";

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
 *
 * @example
 * ```tsx
 * <Tree ctx={ctx} api={api} />
 * ```
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
 * The project tree.
 *
 * @param props - Context and api.
 * @returns The tree region.
 * @example
 * ```tsx
 * <Tree ctx={ctx} api={api} />
 * ```
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

  useEffect(() => {
    if (pendingFocus === undefined) return;
    const items = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const item of items) if (item.dataset.path === pendingFocus) item.focus();
    setPendingFocus(undefined);
  }, [pendingFocus, tree]);

  /**
   * Focuses a row (after the render that shows it).
   *
   * @param path - The row's path.
   * @example
   * ```ts
   * focusRow("flows");
   * ```
   */
  const focusRow = (path: string): void => {
    setFocused(path);
    setPendingFocus(path);
  };

  /**
   * Opens a file or toggles a folder.
   *
   * @param row - The row.
   * @example
   * ```ts
   * activate(row);
   * ```
   */
  const activate = (row: TreeRow): void => {
    focusRow(row.path);
    if (row.kind === "file") {
      openOrLog(ctx, row.path, {});
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
   * @example
   * ```ts
   * onRowKey(row, 0, event);
   * ```
   */
  const onRowKey = (row: TreeRow, position: number, event: KeyboardEvent): void => {
    const target = moveTo(rows, position, event.key);
    const next = rows[position + 1];
    if (target !== undefined) {
      focusRow(rows[target]?.path ?? row.path);
    } else if (event.key === "Enter" || event.key === " ") {
      activate(row);
    } else if (event.key === "ArrowRight" && row.kind === "dir") {
      if (!row.expanded) activate(row);
      else if (next !== undefined && next.level > row.level) focusRow(next.path);
    } else if (event.key === "ArrowLeft") {
      if (row.kind === "dir" && row.expanded) activate(row);
      else if (parentOf(row.path) !== "") focusRow(parentOf(row.path));
    } else {
      return;
    }
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
              {row.path === CAPTURES_DIR &&
                row.expanded &&
                index.children.get(row.path)?.length === 0 && (
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
