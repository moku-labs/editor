/**
 * @file overlay plugin — the Record tab (C5): REC or STOPPED with the clock and counts, Start /
 * Stop, the sent line and meter, the mark field, the marks, the saved logs with Share and Delete,
 * the toast.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import type { LogRow, RecordTabView } from "../model/types";
import { Legend } from "./Legend";
import { Toast } from "./Toast";

/**
 * One saved log's meta line: size, start time and how much was sent.
 *
 * @param props - The row.
 * @param props.row - The log row.
 * @returns The line.
 */
function LogMeta(props: { readonly row: LogRow }): VNode {
  const { row } = props;
  let status: VNode | string = row.statusText;
  if (row.status === "sent") status = <b>{row.statusText}</b>;
  if (row.status === "current") status = <em>{row.statusText}</em>;
  return (
    <span>
      {row.size}, {row.time}, {status}
    </span>
  );
}

/**
 * The Record tab.
 *
 * @param props - The Record tab view and the actions.
 * @param props.tab - The Record tab view.
 * @param props.actions - The actions.
 * @returns The tab's content.
 */
export function RecordTab(props: {
  readonly tab: RecordTabView;
  readonly actions: OverlayActions;
}): VNode {
  const { tab, actions } = props;
  const { key, sent } = tab;
  return (
    <>
      <div data-part="rec-top">
        <Legend legend={tab.legend} rec={tab.recording} />
        <b data-part="clock" data-dim={tab.dim ? "" : undefined}>
          {tab.clock}
        </b>
        <span data-part="rec-stats">
          {tab.stats.map(stat => (
            <span key={stat.text}>
              {stat.value === "" ? undefined : <b>{stat.value}</b>}
              {stat.text}
            </span>
          ))}
        </span>
        <button
          type="button"
          data-part="button"
          data-action={key.action}
          data-warn={key.action === "stop" ? "" : undefined}
          disabled={key.disabled}
          title={key.title}
          onClick={() => {
            actions.record(key.action);
          }}
        >
          {key.label}
        </button>
      </div>
      {sent === undefined ? undefined : (
        <>
          <div data-part="sent">
            <span>Sent to the computer</span>
            {sent.linked ? (
              <>
                <b>{sent.sent} sent</b>
                <em>{sent.pending} pending</em>
              </>
            ) : (
              <span>
                no computer, <em>{sent.pending} pending</em>
              </span>
            )}
          </div>
          {sent.linked ? (
            <div data-part="meter">
              <i style={`width: ${(sent.share * 100).toFixed(1)}%`} />
            </div>
          ) : undefined}
        </>
      )}
      <div data-part="mark-row">
        <input
          data-part="field"
          type="text"
          value={tab.draft}
          placeholder="Mark label, e.g. boss phase 2"
          aria-label="Mark label"
          onInput={event => {
            actions.markDraft(event.currentTarget.value);
          }}
        />
        <button type="button" data-part="button" data-action="mark" onClick={actions.mark}>
          Add mark
        </button>
      </div>
      <ul data-part="marks">
        {tab.marks.map((mark, index) => (
          <li key={`${mark.time}-${index}`}>
            <b>{mark.time}</b>
            <span>{mark.label}</span>
            {mark.auto ? <em>auto, from the game command</em> : undefined}
          </li>
        ))}
      </ul>
      <ul data-part="logs">
        {tab.files.map(row => (
          <li key={row.name}>
            <span data-part="log-name">
              {row.name}
              <LogMeta row={row} />
            </span>
            <button
              type="button"
              data-part="button"
              data-action="share"
              onClick={() => {
                actions.share(row.name);
              }}
            >
              Share
            </button>
            <button
              type="button"
              data-part="button"
              data-action="delete"
              disabled={!row.canDelete}
              onClick={() => {
                actions.remove(row.name);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {tab.toast === undefined ? undefined : <Toast toast={tab.toast} />}
    </>
  );
}
