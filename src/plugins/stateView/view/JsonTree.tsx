/**
 * @file stateView plugin — the collapsible JSON tree of a model root, with change marks from the
 * last commit: `data-changed` and a "was 8" chip or an "added" tag on a changed row,
 * `data-has-change` on its ancestors. ARIA tree with roving tabindex; large containers page.
 */
import type { VNode } from "preact";
import { useRef, useState } from "preact/hooks";
import type { Json } from "../../registry/protocol";
import { compactJson, kindOf, summaryOf, treeKey, treeRows } from "../tree";
import type { LastCommit, StatePatch, StateRoot, StateViewApi, TreeRow } from "../types";
import { useTracker } from "./useTracker";

/**
 * Props of `JsonTree`.
 */
export type JsonTreeProps = {
  readonly api: StateViewApi;
  /** Children shown per container page (config.pageSize). */
  readonly pageSize: number;
  readonly value: Json;
  readonly root: StateRoot;
  /** The last commit, for the change marks. */
  readonly commit: LastCommit | undefined;
};

/**
 * What a row component needs from the tree.
 */
type RowProps<Row> = {
  readonly row: Row;
  readonly active: boolean;
  readonly onKey: (event: KeyboardEvent) => void;
  readonly bind: (element: HTMLElement | null) => void;
};

/**
 * Props of a value row.
 */
type NodeRowProps = RowProps<Extract<TreeRow, { kind: "node" }>> & {
  readonly patch: StatePatch | undefined;
  readonly hasChange: boolean;
  readonly onClick: () => void;
};

/**
 * Props of a "Show N more" row.
 */
type MoreRowProps = RowProps<Extract<TreeRow, { kind: "more" }>> & {
  readonly pageSize: number;
  readonly onMore: () => void;
};

/**
 * The chip after a changed value: "was 8" for a replace, "added" for an add.
 *
 * @param props - The patch of the row.
 * @param props.patch - The patch.
 * @returns The chip, or nothing for a remove.
 */
function ChangeChip(props: { readonly patch: StatePatch }): VNode | undefined {
  const { op, was } = props.patch;
  if (op === "add") {
    return (
      <span data-tag="ok" data-part="added">
        added
      </span>
    );
  }
  if (op !== "replace") return undefined;
  return (
    <span data-tag="err" data-part="was" title={compactJson(was, Number.POSITIVE_INFINITY)}>
      {`was ${compactJson(was)}`}
    </span>
  );
}

/**
 * What follows the key of a value row: ": value" for a leaf, the summary of a closed container,
 * nothing for an open one.
 *
 * @param props - The row.
 * @param props.row - The value row.
 * @returns The value part.
 */
function RowValue(props: { readonly row: Extract<TreeRow, { kind: "node" }> }): VNode | undefined {
  const { row } = props;
  if (row.size === undefined) {
    return (
      <>
        <span data-part="colon">:</span>
        <span data-part="value" data-kind={kindOf(row.value)}>
          {compactJson(row.value)}
        </span>
      </>
    );
  }
  return row.open ? undefined : <span data-part="summary">{summaryOf(row.value)}</span>;
}

/**
 * One value row: twisty, key, then the value, the summary of a closed container, or nothing
 * for an open one; change marks from the commit.
 *
 * @param props - The row, its focus state and handlers, its patch and change mark.
 * @returns The row.
 */
function NodeRow(props: NodeRowProps): VNode {
  const { row, active, patch, hasChange, onKey, onClick, bind } = props;
  const container = row.size !== undefined;
  const twisty = row.open ? "▾" : "▸";
  return (
    <div
      ref={bind}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={container ? row.open : undefined}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-pointer={row.pointer}
      data-changed={patch === undefined ? undefined : ""}
      data-has-change={hasChange ? "" : undefined}
      style={{ "--depth": row.depth }}
      onKeyDown={onKey}
      onClick={onClick}
    >
      <span data-part="twisty" aria-hidden="true">
        {container ? twisty : ""}
      </span>
      <span data-part="key">{row.label}</span>
      <RowValue row={row} />
      {patch === undefined ? undefined : <ChangeChip patch={patch} />}
    </div>
  );
}

/**
 * The "Show N more" row of a paged container.
 *
 * @param props - The row, its focus state and handlers, the page size.
 * @returns The row.
 */
function MoreRow(props: MoreRowProps): VNode {
  const { row, active, pageSize, onKey, onMore, bind } = props;
  return (
    <div
      ref={bind}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-part="show-more-row"
      style={{ "--depth": row.depth }}
      onKeyDown={onKey}
    >
      <button
        type="button"
        data-variant="ghost"
        data-size="sm"
        data-part="show-more"
        tabIndex={-1}
        onClick={onMore}
      >
        {`Show ${Math.min(pageSize, row.hidden)} more`}
      </button>
    </div>
  );
}

/**
 * What the row handlers of one render need.
 */
type TreeControl = {
  readonly api: StateViewApi;
  readonly rows: readonly TreeRow[];
  readonly elements: Map<string, HTMLElement>;
  readonly setFocus: (pointer: string) => void;
};

/**
 * Children shown of a container: its stored page count, else one page.
 *
 * @param shown - Stored counts by container pointer.
 * @param pageSize - One page.
 * @param pointer - The container pointer.
 * @returns How many children show.
 * @example
 * ```ts
 * shownOf(new Map(), 100, "/player"); // 100
 * ```
 */
function shownOf(shown: ReadonlyMap<string, number>, pageSize: number, pointer: string): number {
  return shown.get(pointer) ?? pageSize;
}

/**
 * Makes a row the tab stop and focuses its element.
 *
 * @param control - The tree of this render.
 * @param pointer - The row pointer.
 */
function focusRow(control: TreeControl, pointer: string): void {
  control.setFocus(pointer);
  control.elements.get(pointer)?.focus();
}

/**
 * Applies a key pressed on a row: opens or closes it, or moves the focus.
 *
 * @param control - The tree of this render.
 * @param event - The keydown event.
 * @param index - Index of the row.
 */
function onTreeKey(control: TreeControl, event: KeyboardEvent, index: number): void {
  const action = treeKey(control.rows, index, event.key);
  if (action === undefined) return;
  event.preventDefault();
  if (action.kind === "open") control.api.setExpanded(action.pointer, action.open);
  focusRow(control, action.pointer);
}

/**
 * A click on a value row: toggles a container, focuses the row.
 *
 * @param control - The tree of this render.
 * @param row - The clicked row.
 */
function clickRow(control: TreeControl, row: Extract<TreeRow, { kind: "node" }>): void {
  if (row.size !== undefined) control.api.setExpanded(row.pointer, !row.open);
  focusRow(control, row.pointer);
}

/**
 * Keeps the element of a row (Preact ref callback), forgets it on unmount.
 *
 * @param elements - Elements by row pointer.
 * @param pointer - The row pointer.
 * @param element - The element, null on unmount.
 */
function bindElement(
  elements: Map<string, HTMLElement>,
  pointer: string,
  element: HTMLElement | null
): void {
  if (element === null) elements.delete(pointer);
  else elements.set(pointer, element);
}

/**
 * The JSON tree of one model root.
 *
 * @param props - The api, page size, root value, root name and last commit.
 * @returns The tree.
 */
export function JsonTree(props: JsonTreeProps): VNode {
  const { api, pageSize, value, root, commit } = props;
  useTracker(api);
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(new Map());
  const [focus, setFocus] = useState<string | undefined>();
  const elements = useRef(new Map<string, HTMLElement>()).current;

  const rows = treeRows(value, root, {
    isOpen: api.expanded,
    shown: shownOf.bind(undefined, shown, pageSize)
  });
  const control: TreeControl = { api, rows, elements, setFocus };
  const patches = new Map(commit?.patches.map(patch => [patch.pointer, patch]));
  const active = rows.some(row => row.pointer === focus) ? focus : rows[0]?.pointer;

  return (
    <div data-part="json-tree" role="tree" aria-label={root === "player" ? "Player" : "Session"}>
      {rows.map((row, index) =>
        row.kind === "more" ? (
          <MoreRow
            key={row.pointer}
            row={row}
            active={row.pointer === active}
            pageSize={pageSize}
            onKey={event => onTreeKey(control, event, index)}
            bind={element => bindElement(elements, row.pointer, element)}
            onMore={() => {
              setShown(
                new Map([...shown, [row.parent, shownOf(shown, pageSize, row.parent) + pageSize]])
              );
            }}
          />
        ) : (
          <NodeRow
            key={row.pointer}
            row={row}
            active={row.pointer === active}
            patch={patches.get(row.pointer)}
            hasChange={commit?.ancestors.has(row.pointer) ?? false}
            onKey={event => onTreeKey(control, event, index)}
            bind={element => bindElement(elements, row.pointer, element)}
            onClick={() => clickRow(control, row)}
          />
        )
      )}
    </div>
  );
}
