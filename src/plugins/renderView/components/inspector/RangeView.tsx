/**
 * @file renderView components (inspector) — the inspector's range view (spec 09 § M10 Range view):
 * "f{from}–f{to}" with its frames, seconds and worst frame and Clear; the systems (every one when the
 * engine's detail carried them, else the top 5 with its note, prorated when per second; "Reading the
 * full range …" while the detail read runs), the nodes, the files (open in the editor), the passes,
 * the filters, the shader compiles, the rate changes, the spikes, the GCs and the object counters.
 * Every row that names a frame selects it.
 */
import type { JSX } from "preact";
import {
  CAUSE_LABELS,
  detailNote,
  noRateText,
  rangeHeadline,
  rangeTitle,
  systemsNotes
} from "../../derive/inspector";
import { graphFlags, memoryMeasured } from "../../derive/mission";
import { sectionsView } from "../../derive/monitoring";
import { oneDecimal } from "../../derive/words";
import { MISSION_CAUSE } from "../../timeline/palette";
import type { InspectorView, MonitorSection, RenderViewApi, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { start } from "../start";
import { FileLink } from "./FileLink";
import { OffNote, RowButton, SystemsGrid } from "./Rows";

/** The range view. */
type Range = Extract<InspectorView, { kind: "range" }>;

/**
 * Where a compile ran: "f{frame}, by {view}".
 *
 * @param compile - The compile row.
 * @param compile.frame - Its frame.
 * @param compile.by - The view it compiled for.
 * @returns The words.
 */
function compileWhere(compile: { readonly frame: number; readonly by: string | null }): string {
  return compile.by === null ? `f${compile.frame}` : `f${compile.frame}, by ${compile.by}`;
}

/**
 * Props of `RangeView`.
 */
export type RangeViewProps = {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly view: Range;
  readonly name: string;
};

/**
 * The nodes of the range, or why there are none.
 *
 * @param props - ctx, the view and the Turn on.
 * @param props.ctx - Domain context of renderView.
 * @param props.view - The range view.
 * @param props.onTurnOn - Turns a section on.
 * @returns The list.
 */
function Nodes(props: {
  readonly ctx: RenderViewCtx;
  readonly view: Range;
  readonly onTurnOn: (section: MonitorSection) => void;
}): JSX.Element {
  const { ctx, view } = props;
  const { mission } = ctx.state;
  const sections = sectionsView(
    mission.second?.monitor,
    mission.second?.caps,
    memoryMeasured(mission)
  );
  if (sections?.systems === "off" || sections?.nodes === "off") {
    return (
      <OffNote
        text="Nodes are timed with Systems timing."
        turnOn="nodes"
        onTurnOn={props.onTurnOn}
      />
    );
  }
  const { detail } = mission;
  if (detail.kind === "shown" && detail.nodes === null) {
    return <p data-part="meta">Nodes need a newer engine</p>;
  }
  if (view.nodes.length === 0) return <p data-part="meta">No scene nodes changed</p>;
  return (
    <ul data-part="rows">
      {view.nodes.map(node => (
        <RowButton
          key={`${node.label}-${node.how}`}
          mark={undefined}
          id={node.label}
          text=""
          meta={`${node.how} ${node.count}×`}
          onSelect={undefined}
        />
      ))}
    </ul>
  );
}

/**
 * The range view.
 *
 * @param props - ctx, the api, the range view and the source's name.
 * @returns The section.
 */
export function RangeView(props: RangeViewProps): JSX.Element {
  const { ctx, api, view, name } = props;
  const { mission } = ctx.state;
  const flags = graphFlags(mission);
  const onTurnOn = (section: MonitorSection): void => start(ctx, api.setSection(section, true));
  const select = (frame: number) => (): void => {
    api.select({ from: frame, to: frame });
  };
  const note = detailNote(mission.detail, name);
  const passesMs = view.passes.reduce((sum, pass) => sum + (pass.gpuMs ?? 0), 0);
  const filtersMs = view.filters.reduce((sum, filter) => sum + (filter.gpuMs ?? 0), 0);
  const compilesMs = view.compiles.reduce((sum, compile) => sum + compile.ms, 0);
  const first = view.spikes[0];
  const oneCause = first !== undefined && view.spikes.every(spike => spike.cause === first.cause);
  const spikeFrames = view.spikes.reduce((sum, spike) => sum + spike.to - spike.from + 1, 0);
  return (
    <section data-part="section">
      <header>
        <div data-part="head">
          <span data-part="title" data-mono>
            {rangeTitle(view.range)}
          </span>
          <span data-part="sub">{rangeHeadline(view)}</span>
        </div>
        <button
          type="button"
          data-variant="outline"
          data-size="sm"
          data-action="clear"
          // eslint-disable-next-line unicorn/no-useless-undefined -- select(undefined) clears the selection (the api's contract)
          onClick={() => api.select(undefined)}
        >
          <MissionIcon name="close" size={12} />
          Clear
        </button>
      </header>
      <h3>
        Systems <span data-count>{view.systems.length}</span>
      </h3>
      <SystemsGrid rows={view.systems} share="of range" max="max frame" />
      {systemsNotes(view).map(text => (
        <p key={text} data-part="note">
          {text}
        </p>
      ))}
      {note === undefined ? undefined : <p data-part="note">{note}</p>}
      <h3>
        Nodes <span data-count>{view.nodes.length}</span>
      </h3>
      <Nodes ctx={ctx} view={view} onTurnOn={onTurnOn} />
      <h3>
        Files <span data-count>{view.files.length}</span>
      </h3>
      <ul data-part="rows">
        {view.files.map(row => (
          <FileLink key={`${row.path}:${row.line}`} ctx={ctx} row={row} />
        ))}
      </ul>
      <h3>
        Passes{" "}
        <span data-count>
          {view.passes.length}, {oneDecimal(passesMs)} ms GPU
        </span>
      </h3>
      {flags.passes ? (
        <ul data-part="rows">
          {view.passes.map(pass => (
            <RowButton
              key={pass.label}
              mark={undefined}
              id={pass.label}
              text={`${pass.count}×`}
              meta={
                pass.share !== null && pass.gpuMs === null
                  ? `≈ ${Math.round(pass.share * 100)} %`
                  : `${oneDecimal(pass.gpuMs ?? 0)} ms`
              }
              onSelect={undefined}
            />
          ))}
        </ul>
      ) : (
        <OffNote text="Shaders & passes is off." turnOn="passes" onTurnOn={onTurnOn} />
      )}
      <h3>
        Filters{" "}
        <span data-count>
          {view.filters.length}, {oneDecimal(filtersMs)} ms
        </span>
      </h3>
      <ul data-part="rows">
        {view.filters.map(filter => (
          <RowButton
            key={`${filter.chain}-${filter.target ?? ""}`}
            mark={undefined}
            id={filter.chain}
            text={`${filter.target ?? "—"}, ${filter.count}×`}
            meta={filter.gpuMs === null ? undefined : `${oneDecimal(filter.gpuMs)} ms`}
            onSelect={undefined}
          />
        ))}
      </ul>
      <h3>
        Shader compiles{" "}
        <span data-count>
          {view.compiles.length}, {oneDecimal(compilesMs)} ms
        </span>
      </h3>
      <ul data-part="rows">
        {view.compiles.length === 0 ? (
          <li data-part="meta">No compiles: all {view.frames} frames used cached programs</li>
        ) : undefined}
        {view.compiles.map(compile => (
          <RowButton
            key={`${compile.frame}-${compile.label}`}
            mark={{ shape: "diamond", colour: "pickBlue" }}
            id={compile.label}
            text={compileWhere(compile)}
            meta={`${oneDecimal(compile.ms)} ms`}
            onSelect={select(compile.frame)}
          />
        ))}
      </ul>
      <h3>
        Rate changes <span data-count>{view.rates.length}</span>
      </h3>
      <ul data-part="rows">
        {view.rates.length === 0 ? (
          <li data-part="meta">{noRateText(mission.second)}</li>
        ) : undefined}
        {view.rates.map(rate => (
          <RowButton
            key={`${rate.frame ?? "x"}-${rate.from}-${rate.to}`}
            mark={{ shape: "dot", colour: rate.to < rate.from ? "warn" : "live" }}
            id={rate.frame === null ? "—" : `f${rate.frame}`}
            text={`${rate.from} → ${rate.to}, ${rate.why}`}
            meta="adaptive"
            onSelect={rate.frame === null ? undefined : select(rate.frame)}
          />
        ))}
      </ul>
      <h3>
        Spikes{" "}
        <span data-count>
          {view.spikes.length}
          {oneCause ? ` ${CAUSE_LABELS[first.cause]} ×${spikeFrames}` : ""}
        </span>
      </h3>
      <ul data-part="rows">
        {view.spikes.length === 0 ? <li data-part="meta">No spikes in this range</li> : undefined}
        {view.spikes.map(spike => (
          <RowButton
            key={`${spike.from}-${spike.to}`}
            mark={{ shape: "dot", colour: MISSION_CAUSE[spike.cause] ?? "muted" }}
            id={`f${spike.from}`}
            text={`${spike.label}, ${spike.why}`}
            meta={`${oneDecimal(spike.maxMs)} ms`}
            onSelect={() => api.select({ from: spike.from, to: spike.to })}
          />
        ))}
      </ul>
      <h3>
        GCs <span data-count>{flags.gc === "on" ? view.gcs.length : 0}</span>
      </h3>
      <ul data-part="rows">
        {flags.gc === "none" ? (
          <li data-part="meta">GC is not measured on this device</li>
        ) : undefined}
        {flags.gc === "off" ? <li data-part="meta">Memory & GC is off</li> : undefined}
        {flags.gc === "on" && view.gcs.length === 0 ? (
          <li data-part="meta">No GC in this range</li>
        ) : undefined}
        {flags.gc === "on"
          ? view.gcs.map(gc => (
              <RowButton
                key={gc.frame}
                mark={{ shape: "diamond", colour: "teal" }}
                id={`f${gc.frame}`}
                text={`freed ${oneDecimal(gc.freedMb)} MB`}
                meta={gc.pauseMs === null ? undefined : `pause ${oneDecimal(gc.pauseMs)} ms`}
                onSelect={select(gc.frame)}
              />
            ))
          : undefined}
      </ul>
      {view.objects.length === 0 ? undefined : (
        <>
          <h3>Objects</h3>
          <ul data-part="rows">
            {view.objects.map(row => (
              <RowButton
                key={row.name}
                mark={undefined}
                id={row.name}
                text={`${row.from} → ${row.to}`}
                meta={row.growing ? "growing" : undefined}
                onSelect={undefined}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
