/**
 * @file flowView inspector module — the Info tab (C2): Flow, Node, Kind, Scene, Last visit, File
 * (link to the Code tab); the slot box; Expand in place / Collapse and Enter <flow> on sub-flows;
 * the outcomes (`outcome → target`, ↩ for back edges, waiting, frame of the last fire, ✕ for a
 * rejection) and Comes from (source, outcome, via, frame of the last fire). A row click follows
 * its edge on the canvas (`focus.followEdge`); ↑/↓ move the highlight through the rows, Enter
 * follows it, ←/→ walk (the Flow keys).
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import type { InfoView } from "./types";

/**
 * Props of `InfoTab`.
 */
export type InfoTabProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly info: InfoView;
};

/**
 * Follows a row: its edge when it is drawn, else selects the node it names.
 *
 * @param actions - The flowView actions.
 * @param edgeKey - The row's instance edge, if drawn.
 * @param id - The node the row names, if any.
 */
function follow(actions: FlowActions, edgeKey: string | undefined, id: NodeId | undefined): void {
  if (edgeKey !== undefined && actions.focus.followEdge(edgeKey)) return;
  if (id !== undefined) actions.focus.select(id);
}

/**
 * The Info tab.
 *
 * @param props - Context, actions and the info of the shown node.
 * @returns The tab body.
 */
export function InfoTab(props: InfoTabProps): VNode {
  const { ctx, actions, info } = props;
  const key = info.key;
  const { highlight } = ctx.state.focus;
  /**
   * The highlight attribute of a row.
   *
   * @param side - "to" for Outcomes, "from" for Comes from.
   * @param index - The row index.
   * @returns "" when highlighted, else undefined.
   */
  const marked = (side: "from" | "to", index: number): "" | undefined =>
    highlight.side === side && highlight.index === index ? "" : undefined;
  return (
    <div data-flow="info-tab" data-part="body">
      <dl data-part="properties">
        <dt>Flow</dt>
        <dd>{info.flow}</dd>
        <dt>Node</dt>
        <dd>{info.node}</dd>
        <dt>Kind</dt>
        <dd>{info.kinds.join(" · ")}</dd>
        <dt>Scene</dt>
        <dd>{info.scene ?? "—"}</dd>
        <dt>Last visit</dt>
        <dd>{info.lastVisit}</dd>
        <dt>File</dt>
        <dd>
          <button type="button" data-action="file" onClick={() => actions.inspector.setTab("code")}>
            {info.file ?? "Open the Code tab"}
          </button>
        </dd>
      </dl>
      {info.slot.length > 0 && (
        <div data-part="slot">
          {info.slot.map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {(info.subFlow !== undefined || info.slot.length > 0) && key !== undefined && (
        <div data-part="actions">
          <button
            type="button"
            data-variant="outline"
            onClick={() =>
              info.expanded ? actions.flows.collapse(key) : actions.flows.expand(key)
            }
          >
            {info.expanded ? "Collapse" : "Expand in place"}
          </button>
          {info.subFlow !== undefined && (
            <button type="button" data-variant="outline" onClick={() => actions.flows.enter(key)}>
              {`Enter ${info.subFlow}`}
            </button>
          )}
        </div>
      )}
      <h3>Outcomes</h3>
      <ul data-part="outcomes">
        {info.outcomes.map((row, index) => (
          <li
            key={row.outcome}
            data-outcome={row.outcome}
            data-waiting={row.waiting ? "" : undefined}
            data-highlight={marked("to", index)}
          >
            <button type="button" onClick={() => follow(actions, row.edgeKey, row.targetId)}>
              <span data-part="outcome">{row.outcome}</span>
              {" → "}
              <span data-part="target" data-back={row.back ? "" : undefined}>
                {row.target}
              </span>
            </button>
            {row.waiting && <span data-tag="waiting">waiting</span>}
            {row.frame !== undefined && <code data-part="frame">{row.frame}</code>}
            {row.rejected !== undefined && <span data-tag="rejected">{row.rejected}</span>}
          </li>
        ))}
      </ul>
      <h3>Comes from</h3>
      {info.comesFrom.length === 0 ? (
        <p data-part="empty">Nothing leads here</p>
      ) : (
        <ul data-part="comes-from">
          {info.comesFrom.map((row, index) => (
            <li
              key={`${row.from}:${row.outcome}`}
              data-outcome={row.outcome}
              data-highlight={marked("from", index)}
            >
              <button type="button" onClick={() => follow(actions, row.edgeKey, row.from)}>
                {row.via === undefined
                  ? `${row.from} · ${row.outcome}`
                  : `${row.from} · ${row.outcome} · via ${row.via}`}
              </button>
              {row.frame !== undefined && <code data-part="frame">{row.frame}</code>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
