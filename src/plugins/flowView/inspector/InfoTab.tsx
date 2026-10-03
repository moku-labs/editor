/**
 * @file flowView inspector module — the Info tab (C2): Flow, Node, Kind, Scene, Last visit, File
 * (link to the Code tab); the slot box; Expand in place / Collapse and Enter <flow> on sub-flows;
 * the outcomes (`outcome → target`, ↩ for back edges, waiting, frame of the last fire, ✕ for a
 * rejection); Comes from (click = select); the notes on this node.
 */
import type { VNode } from "preact";
import type { FlowActions, FlowCtx } from "../types";
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
 * The Info tab.
 *
 * @param props - Context, actions and the info of the shown node.
 * @returns The tab body.
 * @example
 * ```tsx
 * <InfoTab ctx={ctx} actions={actions} info={info} />
 * ```
 */
export function InfoTab(props: InfoTabProps): VNode {
  const { ctx, actions, info } = props;
  const notes = ctx.state.notes.files.filter(file => file.note?.from?.node === info.id);
  const key = info.key;
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
            onClick={() =>
              info.expanded ? actions.flows.collapse(key) : actions.flows.expand(key)
            }
          >
            {info.expanded ? "Collapse" : "Expand in place"}
          </button>
          {info.subFlow !== undefined && (
            <button type="button" onClick={() => actions.flows.enter(key)}>
              {`Enter ${info.subFlow}`}
            </button>
          )}
        </div>
      )}
      <h3>Outcomes</h3>
      <ul data-part="outcomes">
        {info.outcomes.map(row => (
          <li key={row.outcome} data-waiting={row.waiting ? "" : undefined}>
            <button
              type="button"
              onClick={() => {
                if (row.targetId !== undefined) actions.focus.select(row.targetId);
              }}
            >
              {`${row.outcome} → ${row.target}`}
            </button>
            {row.back && <span data-tag="back">↩</span>}
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
          {info.comesFrom.map(row => (
            <li key={`${row.from}:${row.outcome}`}>
              <button type="button" onClick={() => actions.focus.select(row.from)}>
                {row.via === undefined
                  ? `${row.from} · ${row.outcome}`
                  : `${row.from} · ${row.outcome} · via ${row.via}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <>
          <h3>Notes on this node</h3>
          <ul data-part="notes">
            {notes.map(file => (
              <li key={file.path}>{file.note?.title}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
