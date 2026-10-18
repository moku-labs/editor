/**
 * @file renderView components (inspector) — the inspector's summary of the view (spec 09 § M10 No
 * selection): "Last {span}" live or "{span} in view" paused with the frames and the source, the hint
 * to drag, the top systems (a note while Systems timing is off), the top passes, the spikes newest
 * first (a row selects its whole group), the GCs and the rate changes in view.
 */
import type { JSX } from "preact";
import { noRateText } from "../../derive/inspector";
import { graphFlags, memoryMeasured } from "../../derive/mission";
import { sectionsView } from "../../derive/monitoring";
import { oneDecimal } from "../../derive/words";
import { paintedScene } from "../../timeline/loop";
import { MISSION_CAUSE } from "../../timeline/palette";
import { laneColourKey } from "../../timeline/scene";
import type { InspectorView, MonitorSection, RenderViewApi, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { start } from "../start";
import { OffNote, RowButton, rowId, SystemsGrid } from "./Rows";

/**
 * Props of `Summary`.
 */
export type SummaryProps = {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly view: Extract<InspectorView, { kind: "summary" }>;
  readonly name: string;
};

/**
 * The hint to drag (accent-soft).
 *
 * @returns The hint.
 */
export function DragHint(): JSX.Element {
  return (
    <div data-hint>
      <MissionIcon name="brush" />
      <p>
        <b>Drag across the graph to see what ran.</b> Click one frame to inspect just it.
      </p>
    </div>
  );
}

/**
 * The summary of the view.
 *
 * @param props - ctx, the api, the summary and the source's name.
 * @returns The section.
 */
export function Summary(props: SummaryProps): JSX.Element {
  const { ctx, api, view, name } = props;
  const { mission } = ctx.state;
  const flags = graphFlags(mission);
  const sections = sectionsView(
    mission.second?.monitor,
    mission.second?.caps,
    memoryMeasured(mission)
  );
  const onTurnOn = (section: MonitorSection): void => start(ctx, api.setSection(section, true));
  const scene = paintedScene(mission);
  const gpu = view.passes.reduce((sum, pass) => sum + (pass.gpuMs ?? 0), 0);
  const spikes = view.spikes.length + view.moreSpikes;
  const gcs = view.gcs.length + view.moreGcs;
  return (
    <section data-part="section">
      <header>
        <div data-part="head">
          <span data-part="title">{view.title}</span>
          <span data-part="sub">
            {view.frames} frames from {name}
          </span>
        </div>
        <span data-tag={mission.view.live ? "ok" : "warn"}>
          {mission.view.live ? "live" : "paused"}
        </span>
      </header>
      <DragHint />
      <h3>Top systems</h3>
      <SystemsGrid rows={view.systems} share="of view" max="max" />
      {sections?.systems === "off" ? (
        <p data-part="note">
          Top 5 per frame. Turn on Systems timing for every system and the nodes.
        </p>
      ) : undefined}
      <h3>
        Top passes <span data-count>{oneDecimal(gpu)} ms GPU</span>
      </h3>
      {flags.passes ? (
        <ul data-part="rows">
          {view.passes.map((pass, index) => (
            <RowButton
              key={pass.label}
              mark={{
                shape: "dot",
                colour: laneColourKey(scene, pass.label.split(" · ")[0] ?? "", index)
              }}
              id={pass.label}
              text=""
              meta={
                pass.gpuMs === null
                  ? undefined
                  : `${oneDecimal(pass.gpuMs)} ms · ${oneDecimal(pass.gpuMs / Math.max(1, view.frames))}/frame`
              }
              onSelect={undefined}
            />
          ))}
        </ul>
      ) : (
        <OffNote text="Shaders & passes is off." turnOn="passes" onTurnOn={onTurnOn} />
      )}
      <h3>
        Spikes in view <span data-count>{spikes}</span>
      </h3>
      <ul data-part="rows">
        {view.spikes.length === 0 ? <li data-part="meta">No spikes in view</li> : undefined}
        {view.spikes.map(spike => (
          <RowButton
            key={`${spike.from}-${spike.to}`}
            mark={{ shape: "dot", colour: MISSION_CAUSE[spike.cause] ?? "muted" }}
            id={rowId(spike.from, spike.to)}
            text={`${spike.label}, ${spike.why}`}
            meta={`${oneDecimal(spike.maxMs)} ms`}
            onSelect={() => api.select({ from: spike.from, to: spike.to })}
          />
        ))}
        {view.moreSpikes > 0 ? (
          <li data-part="more">{view.moreSpikes} more spikes in view</li>
        ) : undefined}
      </ul>
      <h3>
        GCs in view <span data-count>{flags.gc === "on" ? gcs : 0}</span>
      </h3>
      <GcRows ctx={ctx} api={api} view={view} />
      <h3>
        Rate changes in view <span data-count>{view.rates.length}</span>
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
            onSelect={
              rate.frame === null
                ? undefined
                : () => api.select({ from: rate.frame ?? 0, to: rate.frame ?? 0 })
            }
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The GCs in view, or why there are none to show.
 *
 * @param props - ctx, the api and the summary.
 * @param props.ctx - Domain context of renderView.
 * @param props.api - The renderView api.
 * @param props.view - The summary.
 * @returns The list.
 */
function GcRows(props: {
  readonly ctx: RenderViewCtx;
  readonly api: RenderViewApi;
  readonly view: Extract<InspectorView, { kind: "summary" }>;
}): JSX.Element {
  const { ctx, api, view } = props;
  const flags = graphFlags(ctx.state.mission);
  if (flags.gc === "none") {
    return (
      <ul data-part="rows">
        <li data-part="meta">GC is not measured on this device</li>
      </ul>
    );
  }
  if (flags.gc === "off") {
    return (
      <ul data-part="rows">
        <li data-part="meta">Memory & GC is off</li>
      </ul>
    );
  }
  return (
    <ul data-part="rows">
      {view.gcs.length === 0 ? <li data-part="meta">No GC in view</li> : undefined}
      {view.gcs.map(gc => (
        <RowButton
          key={gc.frame}
          mark={{ shape: "diamond", colour: "teal" }}
          id={`f${gc.frame}`}
          text={`freed ${oneDecimal(gc.freedMb)} MB`}
          meta={gc.pauseMs === null ? undefined : `pause ${oneDecimal(gc.pauseMs)} ms`}
          onSelect={() => api.select({ from: gc.frame, to: gc.frame })}
        />
      ))}
      {view.moreGcs > 0 ? <li data-part="more">{view.moreGcs} more GCs in view</li> : undefined}
    </ul>
  );
}
