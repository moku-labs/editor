/**
 * @file overlay plugin — the spike record (C3): back, the frame and when, prev / next with its
 * counter; the lead; the why line; the details.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import type { BarRow, KvRow, RecordView } from "../model/types";
import { SpikeNav } from "./GraphWell";
import { BackIcon } from "./icons";
import { Legend } from "./Legend";

/**
 * A mini bar row.
 *
 * @param props - The bar and its kind.
 * @param props.bar - The bar.
 * @param props.phase - A phase bar (its own colour).
 * @returns The row.
 */
function Bar(props: { readonly bar: BarRow; readonly phase: boolean }): VNode {
  return (
    <div data-part="kv" data-bar="">
      <i>{props.bar.label}</i>
      <span
        data-part="bar"
        data-phase={props.phase ? "" : undefined}
        style={`width: ${props.bar.width}px`}
      />
      <b>{props.bar.value}</b>
    </div>
  );
}

/**
 * A key / value row.
 *
 * @param props - The row.
 * @param props.row - The row.
 * @returns The row element.
 */
function Kv(props: { readonly row: KvRow }): VNode {
  return (
    <div data-part="kv">
      <i>{props.row.label}</i>
      <b data-tone={props.row.tone}>{props.row.value}</b>
    </div>
  );
}

/**
 * A titled column of rows; "—" when empty.
 *
 * @param props - The title and the rows.
 * @param props.title - The section title.
 * @param props.children - The rows.
 * @param props.empty - Whether there are no rows.
 * @returns The column.
 */
function Section(props: {
  readonly title: string;
  readonly empty: boolean;
  readonly children: VNode[];
}): VNode {
  return (
    <div>
      <div data-part="sec">{props.title}</div>
      {props.empty ? <div data-part="kv">—</div> : props.children}
    </div>
  );
}

/**
 * The spike record.
 *
 * @param props - The record view and the actions.
 * @param props.record - The record view.
 * @param props.actions - The actions.
 * @returns The record.
 */
export function SpikeRecord(props: {
  readonly record: RecordView;
  readonly actions: OverlayActions;
}): VNode {
  const { record, actions } = props;
  const severity = record.severity === "ok" ? undefined : record.severity;
  return (
    <div data-record={String(record.frame)}>
      <div data-part="record-head">
        <button
          type="button"
          data-action="back"
          aria-label="Back to the graph"
          onClick={actions.back}
        >
          <BackIcon />
        </button>
        <div data-part="rid">
          <b>{record.title}</b>
          <span>{record.meta}</span>
        </div>
        <span data-part="spacer" />
        <SpikeNav nav={record.nav} dir={-1} actions={actions} />
        <span data-part="count" title="Spikes on the graph, last 6 s">
          {record.nav.counter}
        </span>
        <SpikeNav nav={record.nav} dir={1} actions={actions} />
      </div>
      <div data-part="lead">
        <span data-part="causes" title="All causes, primary first">
          {record.causes.map(legend => (
            <Legend key={legend.text} legend={legend} />
          ))}
        </span>
        <b data-part="word">{record.word}</b>
        <span data-part="ms">
          <span>
            <b data-severity={severity}>{record.ms}</b> ms frame
          </span>
          <em>
            <b data-severity={severity}>{record.over}</b> over <i>{record.budget}</i>
          </em>
        </span>
      </div>
      <p data-part="why" style={`--c: ${record.colour}`}>
        {record.why}
      </p>
      <div data-part="details">
        <div data-part="two">
          <Section title="Phases, ms" empty={record.phases.length === 0}>
            {record.phases.map(bar => (
              <Bar key={bar.label} bar={bar} phase />
            ))}
          </Section>
          <Section title={record.gpuTitle} empty={record.gpu.length === 0}>
            {record.gpu.map((bar, index) => (
              <Bar key={`${bar.label}-${index}`} bar={bar} phase={false} />
            ))}
          </Section>
        </div>
        <div data-part="frame-systems">
          <i>Slowest systems this frame</i>
          {record.systems}
        </div>
        <div data-part="two">
          <Section title="Filters, area" empty={false}>
            {record.filters.map(row => (
              <Kv key={row.label} row={row} />
            ))}
          </Section>
          <Section title="This frame" empty={false}>
            {record.frameRows.map(row => (
              <Kv key={row.label} row={row} />
            ))}
          </Section>
        </div>
        <div data-part="changed">
          <i>What changed</i>
          {record.changed}
        </div>
        {record.pending ? (
          <p data-part="note">More detail arrives with the log line in about a second.</p>
        ) : undefined}
      </div>
    </div>
  );
}
