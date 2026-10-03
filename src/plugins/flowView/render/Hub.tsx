/**
 * @file flowView render module — the hub (G, 200 px wide): head with name, "You are here", kind and
 * scene, "waiting for N outcomes"; one 22 px port row per outcome with a right-aligned label and a
 * dot (accent while the outcome is waited for). Dragging a hub pans.
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, Item } from "../types";
import type { HubView } from "./types";

/**
 * Height of a port row.
 */
const PORT_ROW = 22;

/**
 * Props of `Hub`.
 */
export type HubProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly item: Item;
  readonly view: HubView;
};

/**
 * One hub.
 *
 * @param props - Context, actions, the hub item and its view.
 * @returns The hub.
 */
export function Hub(props: HubProps): VNode {
  const { item, view } = props;
  const count = view.waiting.length;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card holds its own buttons; a <button> cannot nest them
    <div
      data-flow="hub"
      data-hit="hub-head"
      data-key={item.key}
      data-selected={view.selected ? "" : undefined}
      data-current={view.current ? "" : undefined}
      data-dimmed={view.dimmed ? "" : undefined}
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
      <div data-part="head">
        <span data-part="name">{view.name}</span>
        {view.current && <span data-tag="current">You are here</span>}
        <span data-part="kind">{view.kindLine}</span>
        {view.current && count > 0 && (
          <span data-part="waiting">{`waiting for ${count} ${count === 1 ? "outcome" : "outcomes"}`}</span>
        )}
      </div>
      {view.outcomes.map(outcome => (
        <div
          key={outcome}
          data-part="port"
          data-outcome={outcome}
          data-hit="outcome"
          data-source={item.key}
          data-waiting={view.waiting.includes(outcome) ? "" : undefined}
          style={{ top: `${(item.ports?.[outcome] ?? 0) - PORT_ROW / 2}px` }}
        >
          <span data-part="label">{outcome}</span>
          <span data-part="dot" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
