/**
 * @file flowView render module — the node card (G, 172×44): glyph, name, "on stack", pinned mark
 * (F9) and the expand toggle of sub-flows on row 1, the kind line on row 2; every state is a data
 * attribute. Memoised: a card re-renders only when its item or its view changes.
 */
import type { VNode } from "preact";
import { memo } from "preact/compat";
import type { FlowActions, FlowCtx, Item } from "../types";
import { shallowEqual } from "../useFlowStore";
import type { CardView } from "./types";

/**
 * Props of `NodeCard`.
 */
export type NodeCardProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly item: Item;
  readonly view: CardView;
};

/**
 * The card, unmemoised.
 *
 * @param props - Context, actions, the item and its view.
 * @returns The card.
 * @example
 * ```tsx
 * <Card ctx={ctx} actions={actions} item={item} view={view} />
 * ```
 */
function Card(props: NodeCardProps): VNode {
  const { actions, item, view } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card holds its own buttons; a <button> cannot nest them
    <div
      data-flow="node-card"
      data-hit="card"
      data-key={item.key}
      data-kind={view.glyph}
      data-selected={view.selected ? "" : undefined}
      data-current={view.current ? "" : undefined}
      data-dimmed={view.dimmed ? "" : undefined}
      data-pinned={item.pinned ? "" : undefined}
      data-trail={view.trail ? "" : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={view.selected}
      aria-current={view.current ? "location" : undefined}
      aria-label={item.id}
      style={{
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.w}px`,
        height: `${item.h}px`
      }}
    >
      <span data-part="row">
        <span data-part="glyph" data-glyph={view.glyph} aria-hidden="true" />
        <span data-part="name">{view.name}</span>
        {view.onStack && <span data-tag="on-stack">on stack</span>}
        {item.pinned && <span data-part="pin" role="img" aria-label="Pinned" />}
        {view.expandable && (
          <button
            type="button"
            data-part="expand"
            aria-label={`Expand ${item.id}`}
            onClick={event => {
              event.stopPropagation();
              actions.flows.expand(item.key);
            }}
            onPointerDown={event => event.stopPropagation()}
          >
            ▸
          </button>
        )}
      </span>
      <span data-part="kind">{view.kindLine}</span>
    </div>
  );
}

/**
 * The node card: re-renders only when its item or a field of its view changes.
 *
 * @example
 * ```tsx
 * <NodeCard ctx={ctx} actions={actions} item={item} view={world.cards.get(item.key)} />
 * ```
 */
export const NodeCard = memo(
  Card,
  (before, after) => before.item === after.item && shallowEqual(before.view, after.view)
);
