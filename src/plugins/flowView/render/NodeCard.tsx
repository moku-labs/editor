/**
 * @file flowView render module — the node card (G, 172×44, taller for many outcomes): glyph,
 * name, "on stack", pinned mark (F9) and the expand toggle of sub-flows on row 1, the kind line on
 * row 2; every state is a data attribute (a dimmed card stays opaque, only its content fades). The positioned `data-flow="node"` box holds the focusable card and, next to it, the
 * expand button drawn over row 1: a button inside a `role="button"` card would be a nested
 * interactive control. Memoised: a card re-renders only when its item or its view changes.
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
 * The tag on row 1: "here" on a card holding the current node (a collapsed sub-flow or slot with
 * it inside), else "on stack" for a card on the stack.
 *
 * @param view - The card view.
 * @returns The tag, or false.
 * @example
 * ```tsx
 * <span data-part="row">{stackTag(view)}</span>
 * ```
 */
function stackTag(view: CardView): VNode | false {
  if (view.holdsCurrent && !view.current) return <span data-tag="here">here</span>;
  return view.onStack && <span data-tag="on-stack">on stack</span>;
}

/**
 * The card, unmemoised.
 *
 * @param props - Context, actions, the item and its view.
 * @returns The card.
 */
function Card(props: NodeCardProps): VNode {
  const { actions, item, view } = props;
  return (
    <div
      data-flow="node"
      style={{
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.w}px`,
        height: `${item.h}px`
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a card holds tags and a pin mark; a <button> cannot hold the layout */}
      <div
        data-flow="node-card"
        data-hit="card"
        data-key={item.key}
        data-kind={view.glyph}
        data-selected={view.selected ? "" : undefined}
        data-current={view.current ? "" : undefined}
        data-holds-current={view.holdsCurrent && !view.current ? "" : undefined}
        data-dimmed={view.dimmed ? "" : undefined}
        data-pulse={view.pulse ? "" : undefined}
        data-pinned={item.pinned ? "" : undefined}
        data-trail={view.trail ? "" : undefined}
        data-expandable={view.expandable ? "" : undefined}
        role="button"
        tabIndex={0}
        aria-pressed={view.selected}
        aria-current={view.current ? "location" : undefined}
        aria-label={item.id}
      >
        <span data-part="row">
          <span data-part="glyph" data-glyph={view.glyph} aria-hidden="true" />
          <span data-part="name">{view.name}</span>
          {stackTag(view)}
          {item.pinned && <span data-part="pin" role="img" aria-label="Pinned" />}
        </span>
        <span data-part="kind">{view.kindLine}</span>
      </div>
      {view.expandable && (
        <button
          type="button"
          data-part="expand"
          data-hit="card"
          data-key={item.key}
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
    </div>
  );
}

/**
 * The node card: re-renders only when its item or a field of its view changes.
 */
export const NodeCard = memo(
  Card,
  (before, after) => before.item === after.item && shallowEqual(before.view, after.view)
);
