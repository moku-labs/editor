/**
 * @file renderView device strip — the record side panel (design §7, F5): the empty state while
 * closed; else the header (close key, "Frame N" and its sub-line, prev / counter / next), and for
 * a shown record the lead (cause legends, the primary's word, ms against the frame's own budget),
 * the why line and the scrolling details (phases, GPU passes, systems, filters, this frame, what
 * changed).
 */
import type { VNode } from "preact";
import type { RenderViewCtx } from "../../types";
import { themedColour } from "../colour";
import { recordView } from "../record";
import type { BarRow, DeviceStripView, RecordState, RecordView, ValueRow } from "../types";
import { closeSpike } from "../watch";
import { Annunciator } from "./Annunciator";
import { SpikeKeys } from "./StripGraph";

/**
 * Props of `SpikePanel`.
 */
export type SpikePanelProps = { readonly ctx: RenderViewCtx; readonly view: DeviceStripView };

/**
 * The close mark, 18 px.
 *
 * @returns The inline SVG.
 */
function CloseMark(): VNode {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}

/**
 * Rows with bars, under a section title.
 *
 * @param props - The title and the rows.
 * @param props.title - The section title.
 * @param props.rows - The rows.
 * @param props.kind - "phases" or "gpu": the bar colour (GPU bars in the graph's GPU colour).
 * @returns The section.
 */
function Bars(props: {
  readonly title: string;
  readonly rows: readonly BarRow[];
  readonly kind: "phases" | "gpu";
}): VNode {
  return (
    <section
      data-part="bars"
      data-kind={props.kind}
      style={props.kind === "gpu" ? { "--c": themedColour("gpu") } : undefined}
    >
      <h3>{props.title}</h3>
      {props.rows.map(row => (
        <div key={row.label} data-part="bar-row">
          <span data-part="label">{row.label}</span>
          <span data-part="bar">
            <span style={{ inlineSize: `${Math.round(row.share * 100)}%` }} />
          </span>
          <span data-part="value">{row.value}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * Label and value rows, under a section title.
 *
 * @param props - The title and the rows.
 * @param props.title - The section title.
 * @param props.rows - The rows.
 * @returns The section.
 */
function Values(props: { readonly title: string; readonly rows: readonly ValueRow[] }): VNode {
  return (
    <section data-part="values">
      <h3>{props.title}</h3>
      {props.rows.map(row => (
        <div key={row.label} data-part="value-row">
          <span data-part="label">{row.label}</span>
          <span data-part="value" data-tone={row.tone}>
            {row.value}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * The lead, the why line and the details of a shown record.
 *
 * @param props - The record view.
 * @param props.record - The rows of the record.
 * @returns The body.
 */
function RecordBody(props: { readonly record: RecordView }): VNode {
  const { record } = props;
  return (
    <>
      <div data-part="lead">
        <span data-part="causes">
          {record.causes.map(cause => (
            <Annunciator
              key={cause.cause}
              text={cause.legend}
              colour={cause.hue}
              lit={cause.lit}
              hollow={cause.hollow}
              size="lead"
            />
          ))}
        </span>
        <span data-part="word">{record.word}</span>
        <span data-part="numbers" data-severity={record.severity}>
          <span>
            <b data-part="ms">{record.ms}</b> ms frame
          </span>
          <span>
            <b>{record.over}</b>{" "}
            <b data-part="budget" style={{ "--c": themedColour("magenta") }}>
              {record.budget}
            </b>
          </span>
        </span>
      </div>
      <p data-part="why" style={{ "--c": record.hue }}>
        {record.why}
      </p>
      <div data-part="details">
        <div data-part="columns">
          <Bars title="Phases, ms" rows={record.phases} kind="phases" />
          <Bars title={record.gpuTitle} rows={record.passes} kind="gpu" />
        </div>
        {record.systems === undefined ? undefined : (
          <Bars title="Slowest systems this frame" rows={record.systems} kind="phases" />
        )}
        <div data-part="columns">
          {record.filters === undefined ? undefined : (
            <Values title="Filters" rows={record.filters} />
          )}
          <Values title="This frame" rows={record.thisFrame} />
        </div>
        {record.changed === undefined ? undefined : (
          <section data-part="changed">
            <h3>What changed</h3>
            <p>{record.changed}</p>
          </section>
        )}
        {record.note === undefined ? undefined : <p data-part="note">{record.note}</p>}
      </div>
    </>
  );
}

/**
 * The header's sub-line and the body of a record state other than closed.
 *
 * @param record - The record state.
 * @param ctx - Domain context of renderView.
 * @returns The sub-line and the body.
 */
function contentOf(
  record: Exclude<RecordState, { kind: "closed" }>,
  ctx: RenderViewCtx
): { sub: string; body: VNode | undefined } {
  if (record.kind === "loading") return { sub: "Loading the record…", body: undefined };
  if (record.kind === "gone") {
    return {
      sub: "Gone",
      body: <p data-part="note">Frame {record.frame} is no longer on the phone.</p>
    };
  }
  if (record.kind === "failed") {
    return { sub: "Read failed", body: <p data-part="note">{record.message}</p> };
  }
  const view = recordView(record.record, ctx.state.device.recorder);
  return { sub: view.sub, body: <RecordBody record={view} /> };
}

/**
 * The record side panel.
 *
 * @param props - ctx and the strip view.
 * @returns The panel.
 */
export function SpikePanel(props: SpikePanelProps): VNode {
  const { ctx, view } = props;
  const { record } = ctx.state.device;
  if (record.kind === "closed") {
    return (
      <aside data-part="side" aria-label="Spike record">
        <div data-part="empty">
          <b>No spike selected</b>
          Click a legend flag, a tall bar or the chevrons to see why that frame ran long.
        </div>
      </aside>
    );
  }

  const { sub, body } = contentOf(record, ctx);
  return (
    <aside data-part="side" aria-label="Spike record" data-record={record.kind}>
      <header data-part="record-head">
        <button
          type="button"
          data-action="close-record"
          aria-label="Close the record"
          onClick={() => closeSpike(ctx)}
        >
          <CloseMark />
        </button>
        <div data-part="record-id">
          <b>Frame {record.frame}</b>
          <span>{sub}</span>
        </div>
        <SpikeKeys ctx={ctx} view={view} part="record-nav" />
      </header>
      {body}
    </aside>
  );
}
