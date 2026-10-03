/**
 * @file stateView plugin — the JSON tree model (pure): the visible rows of a root for the
 * JsonTree view, the container pointers for Expand all, and the compact value texts.
 */
import type { Json } from "../registry/protocol";
import { escapeSegment } from "./diff";
import { isRecord } from "./model";
import type { StateRoot, TreeKeyAction, TreeOptions, TreeRow } from "./types";

/**
 * Longest compact value text, the ellipsis included.
 */
const COMPACT_LIMIT = 120;

/**
 * The children of an object or array as [key, value] pairs; undefined for a leaf.
 *
 * @param value - A JSON value.
 * @returns The children, or undefined.
 * @example
 * ```ts
 * childrenOf(["a"]); // [["0", "a"]]
 * ```
 */
function childrenOf(value: Json): [string, Json][] | undefined {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  return isRecord(value) ? Object.entries(value) : undefined;
}

/**
 * Adds the row of a value and, when it is an open container, the rows of its shown children
 * and a "more" row for the hidden ones.
 *
 * @param rows - Where the rows go.
 * @param options - Open state and page size per container.
 * @param row - The row of the value.
 * @param row.value - The value.
 * @param row.pointer - Its pointer.
 * @param row.label - Its key, index or root name.
 * @param row.depth - Its depth.
 * @param row.parent - Pointer of the parent row.
 */
function visit(
  rows: TreeRow[],
  options: TreeOptions,
  row: {
    readonly value: Json;
    readonly pointer: string;
    readonly label: string;
    readonly depth: number;
    readonly parent: string | undefined;
  }
): void {
  const { value, pointer, depth } = row;
  const children = childrenOf(value);
  const open = children !== undefined && options.isOpen(pointer, depth);
  rows.push({ kind: "node", ...row, size: children?.length, open });
  if (!open) return;

  const limit = options.shown(pointer);
  for (const [key, child] of children.slice(0, limit)) {
    visit(rows, options, {
      value: child,
      pointer: `${pointer}/${escapeSegment(key)}`,
      label: key,
      depth: depth + 1,
      parent: pointer
    });
  }
  if (children.length > limit) {
    rows.push({
      kind: "more",
      pointer: `${pointer}#more`,
      parent: pointer,
      depth: depth + 1,
      hidden: children.length - limit
    });
  }
}

/**
 * The visible rows of a root, depth first, in key order.
 *
 * @param value - The root value.
 * @param root - "player" or "session"; the root row is `/<root>` at depth 0.
 * @param options - Open state and page size per container.
 * @returns The rows.
 * @example
 * ```ts
 * treeRows({ a: 1 }, "player", { isOpen: () => true, shown: () => 100 }).length; // 2
 * ```
 */
export function treeRows(value: Json, root: StateRoot, options: TreeOptions): TreeRow[] {
  const rows: TreeRow[] = [];
  visit(rows, options, { value, pointer: `/${root}`, label: root, depth: 0, parent: undefined });
  return rows;
}

/**
 * Adds the pointer of a container and of every container below it.
 *
 * @param pointers - Where the pointers go.
 * @param value - The value.
 * @param pointer - Its pointer.
 * @example
 * ```ts
 * collectContainers(pointers, { a: [1] }, "/session"); // pointers: ["/session", "/session/a"]
 * ```
 */
function collectContainers(pointers: string[], value: Json, pointer: string): void {
  const children = childrenOf(value);
  if (children === undefined) return;
  pointers.push(pointer);
  for (const [key, child] of children)
    collectContainers(pointers, child, `${pointer}/${escapeSegment(key)}`);
}

/**
 * Every object and array pointer under a root, the root included.
 *
 * @param value - The root value.
 * @param root - "player" or "session".
 * @returns The pointers, depth first.
 * @example
 * ```ts
 * containerPointers({ a: { b: 1 } }, "player"); // ["/player", "/player/a"]
 * ```
 */
export function containerPointers(value: Json, root: StateRoot): string[] {
  const pointers: string[] = [];
  collectContainers(pointers, value, `/${root}`);
  return pointers;
}

/**
 * Compact JSON of a value, cut at `limit` characters with "…"; "" for undefined.
 *
 * @param value - The value.
 * @param limit - Longest text, the ellipsis included.
 * @returns The text.
 * @example
 * ```ts
 * compactJson({ reason: "empty" }); // '{"reason":"empty"}'
 * ```
 */
export function compactJson(value: Json | undefined, limit = COMPACT_LIMIT): string {
  if (value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * The kind of a JSON value, for the `data-kind` of a tree value.
 *
 * @param value - The value.
 * @returns "number", "string", "boolean", "null", "array" or "object".
 * @example
 * ```ts
 * kindOf(7); // "number"
 * ```
 */
export function kindOf(value: Json): "number" | "string" | "boolean" | "null" | "array" | "object" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "number": {
      return "number";
    }
    case "string": {
      return "string";
    }
    case "boolean": {
      return "boolean";
    }
    default: {
      return "object";
    }
  }
}

/**
 * The summary of a closed container (`{3}`, `[2]`); compact JSON for a leaf.
 *
 * @param value - The value.
 * @returns The summary.
 * @example
 * ```ts
 * summaryOf([1, 2]); // "[2]"
 * ```
 */
export function summaryOf(value: Json): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isRecord(value)) return `{${Object.keys(value).length}}`;
  return compactJson(value);
}

/**
 * A focus move to the row at an index, when it exists.
 *
 * @param rows - The visible rows.
 * @param index - The row index.
 * @returns The action, or undefined.
 * @example
 * ```ts
 * focusAt(rows, 0); // { kind: "focus", pointer: "/player" }
 * ```
 */
function focusAt(rows: readonly TreeRow[], index: number): TreeKeyAction | undefined {
  const row = rows[index];
  return row === undefined ? undefined : { kind: "focus", pointer: row.pointer };
}

/**
 * What a key does on a tree row (ARIA tree pattern): ↑/↓ move, Home/End jump, → opens a closed
 * container or moves to its first child, ← closes an open container or moves to the parent.
 *
 * @param rows - The visible rows.
 * @param index - Index of the row the key was pressed on.
 * @param key - KeyboardEvent.key.
 * @returns The action, or undefined when the key does nothing.
 * @example
 * ```ts
 * treeKey(rows, 0, "ArrowDown"); // { kind: "focus", pointer: "/player/merge" }
 * ```
 */
export function treeKey(
  rows: readonly TreeRow[],
  index: number,
  key: string
): TreeKeyAction | undefined {
  const row = rows[index];
  if (row === undefined) return undefined;
  const size = row.kind === "node" ? row.size : undefined;
  const open = row.kind === "node" && row.open;
  switch (key) {
    case "ArrowDown": {
      return focusAt(rows, index + 1);
    }
    case "ArrowUp": {
      return focusAt(rows, Math.max(0, index - 1));
    }
    case "Home": {
      return focusAt(rows, 0);
    }
    case "End": {
      return focusAt(rows, rows.length - 1);
    }
    case "ArrowRight": {
      if (size === undefined) return undefined;
      if (!open) return { kind: "open", pointer: row.pointer, open: true };
      return size > 0 ? focusAt(rows, index + 1) : undefined;
    }
    case "ArrowLeft": {
      if (open) return { kind: "open", pointer: row.pointer, open: false };
      return row.parent === undefined ? undefined : { kind: "focus", pointer: row.parent };
    }
    default: {
      return undefined;
    }
  }
}
