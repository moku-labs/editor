/**
 * @file renderView plugin — one render tree row (twisty, name, type badge, texture / entity / key
 * markers) and its inline C9 detail (path, bounds, texture, style keys, entity, Inspect in Game).
 * Hover or focus rings the element over the game frame.
 */
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { SceneNode } from "../../panels/shared/scene";
import { highlightRef, inspectInGame, selectNode, setOpen } from "../actions";
import { boundsText, fixed } from "../format";
import type { RenderViewCtx, TreeRow as TreeRowData } from "../types";

/**
 * Props of `TreeRow`.
 */
export type TreeRowProps = {
  readonly ctx: RenderViewCtx;
  readonly row: TreeRowData;
  readonly selected: boolean;
  /** Show the inline detail under the row. */
  readonly detail: boolean;
};

/**
 * Props of `TreeDetail`.
 */
export type TreeDetailProps = { readonly ctx: RenderViewCtx; readonly node: SceneNode };

/**
 * The texture line of the detail: `key · w×h · MB` from the catalogue, else the key alone.
 *
 * @param ctx - Domain context of renderView.
 * @param key - The texture key.
 * @returns The line.
 * @example
 * ```ts
 * textureLine(ctx, "board.cell"); // "board.cell · 224×219 · 0.19 MB"
 * ```
 */
function textureLine(ctx: RenderViewCtx, key: string): string {
  const info = ctx.state.catalogue?.textures.get(key);
  return info === undefined
    ? key
    : `${key} · ${info.width}×${info.height} · ${fixed(info.gpuMb)} MB`;
}

/**
 * The inline detail of the selected row (C9).
 *
 * @param props - ctx and the scene node.
 * @returns The detail list.
 * @example
 * ```tsx
 * <TreeDetail ctx={ctx} node={scene.nodes.get("entity:3145728")} />
 * ```
 */
export function TreeDetail(props: TreeDetailProps): JSX.Element {
  const { ctx, node } = props;
  const { ref, texture, style, entity } = node;
  return (
    <dl data-detail data-props>
      <dt>Path</dt>
      <dd data-mono>{ref.kind === "ui" ? ref.path : `entity ${ref.id}`}</dd>
      <dt>Bounds</dt>
      <dd data-mono>{boundsText(node.rect)}</dd>
      {texture === undefined ? undefined : (
        <>
          <dt>Texture</dt>
          <dd data-mono>{textureLine(ctx, texture)}</dd>
        </>
      )}
      {style === undefined ? undefined : (
        <>
          <dt>Style</dt>
          <dd data-mono>{Object.keys(style).join(", ")}</dd>
        </>
      )}
      {entity === undefined ? undefined : (
        <>
          <dt>Entity</dt>
          <dd data-mono>
            {entity.id} · {entity.components.join(", ")}
          </dd>
        </>
      )}
      <dt />
      <dd>
        <button type="button" data-action="inspect" onClick={() => inspectInGame(ctx, ref)}>
          Inspect in Game
        </button>
      </dd>
    </dl>
  );
}

/**
 * One row of the render tree.
 *
 * @param props - ctx, the row, whether it is selected and shows its detail.
 * @returns The treeitem.
 * @example
 * ```tsx
 * <TreeRow ctx={ctx} row={row} selected={row.id === selected} detail={false} />
 * ```
 */
export function TreeRow(props: TreeRowProps): JSX.Element {
  const { ctx, row, selected, detail } = props;
  const element = useRef<HTMLDivElement>(null);
  const node = ctx.state.scene?.nodes.get(row.id);

  useEffect(() => {
    if (selected) element.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tree handles the keys (roving focus, C9)
    <div
      ref={element}
      role="treeitem"
      data-id={row.id}
      data-selected={selected ? "" : undefined}
      data-open={row.open ? "" : undefined}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.open : undefined}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      style={{ "--depth": row.depth }}
      onClick={() => selectNode(ctx, row.id)}
      onPointerEnter={() => highlightRef(ctx, node?.ref)}
      onPointerLeave={() => highlightRef(ctx)}
      onFocus={() => highlightRef(ctx, node?.ref)}
      onBlur={() => highlightRef(ctx)}
    >
      <span data-line>
        <button
          type="button"
          data-twisty
          tabIndex={-1}
          hidden={!row.hasChildren}
          aria-label={row.open ? "Collapse" : "Expand"}
          onClick={event => {
            event.stopPropagation();
            setOpen(ctx, row.id);
          }}
        >
          {row.open ? "▾" : "▸"}
        </button>
        <span data-name>{row.name}</span>
        <span data-tag="mut">{row.type}</span>
        {row.texture === undefined ? undefined : <span data-marker="texture">{row.texture}</span>}
        {row.entity === undefined ? undefined : <span data-marker="entity">#{row.entity}</span>}
        {row.key === undefined ? undefined : <span data-marker="key">{row.key}</span>}
      </span>
      {detail && node !== undefined ? <TreeDetail ctx={ctx} node={node} /> : undefined}
    </div>
  );
}
