/**
 * @file filesView plugin — the pure tree model: children, file count, reveal, folder toggle,
 * the visible rows of the project tree and the files in tree order.
 */
import type { FileEntry } from "../../registry/protocol";
import type { FileIndex, TreeRow } from "../types";

/**
 * The children of a folder, folders first.
 *
 * @param index - The file index.
 * @param dir - Folder path, `""` for the root.
 * @returns Child paths; `[]` for an unknown folder.
 * @example
 * ```ts
 * childrenOf(index, "flows"); // ["flows/board.ts", "flows/main.ts"]
 * ```
 */
export function childrenOf(index: FileIndex, dir: string): readonly string[] {
  return index.children.get(dir) ?? [];
}

/**
 * The number of indexed files (folders not counted).
 *
 * @param index - The file index.
 * @returns The file count.
 */
export function countFiles(index: FileIndex): number {
  return index.files.size;
}

/**
 * The folder of a path.
 *
 * @param path - A relative path.
 * @returns The parent folder, `""` at the root.
 * @example
 * ```ts
 * parentOf("nodes/merge.ts"); // "nodes"
 * ```
 */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * The last segment of a path.
 *
 * @param path - A relative path.
 * @returns The base name.
 * @example
 * ```ts
 * nameOf("nodes/merge.ts"); // "merge.ts"
 * ```
 */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Opens every ancestor folder of a path, so its row is visible.
 *
 * @param expanded - The open folders (changed in place).
 * @param path - A file or folder path.
 * @example
 * ```ts
 * revealPath(expanded, "nodes/deep/x.ts"); // expanded has "nodes" and "nodes/deep"
 * ```
 */
export function revealPath(expanded: Set<string>, path: string): void {
  const segments = path.split("/");
  for (let end = 1; end < segments.length; end += 1) {
    expanded.add(segments.slice(0, end).join("/"));
  }
}

/**
 * Opens a closed folder or closes an open one.
 *
 * @param expanded - The open folders (changed in place).
 * @param path - The folder path.
 * @returns Whether the folder is open now.
 * @example
 * ```ts
 * toggleFolder(new Set(), "flows"); // true
 * ```
 */
export function toggleFolder(expanded: Set<string>, path: string): boolean {
  if (expanded.delete(path)) return false;
  expanded.add(path);
  return true;
}

/**
 * The rows the tree shows: the root's children, and the children of every open folder below
 * its row.
 *
 * @param index - The file index.
 * @param expanded - The open folders.
 * @returns The rows in display order.
 * @example
 * ```ts
 * visibleRows(index, new Set(["flows"])).map(row => row.path); // ["flows", "flows/board.ts", …]
 * ```
 */
export function visibleRows(index: FileIndex, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const pending: { path: string; level: number }[] = childrenOf(index, "")
    .map(path => ({ path, level: 1 }))
    .toReversed();

  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    const isDir = !index.files.has(next.path);
    const open = isDir && expanded.has(next.path);
    rows.push({
      path: next.path,
      name: nameOf(next.path),
      kind: isDir ? "dir" : "file",
      level: next.level,
      expanded: open
    });
    if (open) {
      for (const child of childrenOf(index, next.path).toReversed()) {
        pending.push({ path: child, level: next.level + 1 });
      }
    }
  }
  return rows;
}

/**
 * Every indexed file in tree order: depth first, folders first at every level.
 *
 * @param index - The file index.
 * @returns The file entries.
 * @example
 * ```ts
 * filesInTreeOrder(index).map(entry => entry.path); // ["flows/board.ts", "flows/main.ts", …]
 * ```
 */
export function filesInTreeOrder(index: FileIndex): FileEntry[] {
  const entries: FileEntry[] = [];
  const pending = [...childrenOf(index, "")].toReversed();

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) break;
    const entry = index.files.get(path);
    if (entry === undefined) pending.push(...[...childrenOf(index, path)].toReversed());
    else entries.push(entry);
  }
  return entries;
}
