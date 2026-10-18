/**
 * @file renderView components (cards) — the Device load card across the grid (spec 09 § M9 Device
 * load): two halves, CPU per process (app, WebView renderer, surfaceflinger as % of all cores, their
 * colour keys, the stacked steps the loop paints on the shared axis and the total line) and GPU (busy
 * %, the clock with its DVFS range, the busy area and the clock line); each value's title holds its
 * source. Read over USB only: another source says so.
 */
import type { JSX } from "preact";
import { selectionTimes } from "../../derive/cards";
import type { LoadValue } from "../../derive/load";
import { loadInSelection, loadView } from "../../derive/load";
import type { CardOff } from "../../derive/states";
import { DASH } from "../../derive/words";
import type { PaletteKey } from "../../timeline/palette";
import type { MonitorSection, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { OffPanel, SourceMark } from "./SparkCard";

/**
 * Props of `DeviceLoadCard`.
 */
export type DeviceLoadCardProps = {
  readonly ctx: RenderViewCtx;
  /** The panel of the source's state (not started, waiting) before the card's own. */
  readonly off: CardOff | undefined;
  readonly onTurnOn: (section: MonitorSection) => void;
};

/** The colour key of each CPU process (spec 09 § M9: app in the source tint). */
const CPU_COLOURS: readonly PaletteKey[] = ["src", "phase1", "edge"];

/**
 * Props of `Value`.
 */
type ValueProps = { readonly value: LoadValue; readonly colour?: PaletteKey | undefined };

/**
 * One value: its number bold, its unit (a CPU value adds its process's name), its source in the
 * title; "—" and the name when it is not available.
 *
 * @param props - The value and, for a CPU value, its colour key.
 * @returns The pair.
 */
function Value(props: ValueProps): JSX.Element {
  const { value, colour } = props;
  const [number = DASH, ...rest] = value.value.split(" ");
  const cpu = colour !== undefined;
  let unit = rest.join(" ");
  if (value.value === DASH) unit = value.name;
  else if (cpu) unit = `${unit} ${value.name}`;
  return (
    <span data-part="pair" title={value.title}>
      {cpu ? <i data-mark="square" data-colour={colour} aria-hidden="true" /> : undefined}
      <strong>{number}</strong>
      <span data-part="unit">{unit}</span>
    </span>
  );
}

/**
 * The card's own panel when it has no telemetry: read over USB only.
 *
 * @param ctx - Domain context of renderView.
 * @returns The panel; undefined with a wired record.
 */
function wiredOff(ctx: RenderViewCtx): CardOff | undefined {
  const { mission } = ctx.state;
  if (mission.telemetry?.wired === true) return undefined;
  const none = { turnOn: undefined, spinner: false };
  if (mission.source?.kind === "device") {
    return {
      ...none,
      title: "Device load is read over USB only",
      body: "Connect an Android phone by wire to see CPU, GPU clock and memory per process."
    };
  }
  return {
    ...none,
    title: "Device load is for a phone on USB",
    body: "Connect an Android phone by wire to see CPU per process, GPU busy and the GPU clock."
  };
}

/**
 * The Device load card.
 *
 * @param props - ctx and the source's panel.
 * @returns The card.
 */
export function DeviceLoadCard(props: DeviceLoadCardProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const view = loadView(mission.telemetry);
  const off = props.off ?? wiredOff(ctx);
  const times =
    mission.selection === undefined
      ? undefined
      : selectionTimes(mission.history, mission.selection);
  const inSelection =
    times === undefined ? undefined : loadInSelection(mission.series.load, times.from, times.to);
  return (
    <article data-spark-card data-card-kind="load" data-full="">
      <header>
        <h3>Device load</h3>
        {view === undefined ? undefined : (
          <span data-part="srcnote">
            <MissionIcon name="wire" size={12} />
            over USB (adb), 1 s
          </span>
        )}
        <SourceMark ctx={ctx} />
      </header>
      <div data-part="halves">
        <section data-part="half">
          <h4>CPU per process</h4>
          <p data-part="value">
            {view?.cpu.values.map((value, index) => (
              <Value key={value.name} value={value} colour={CPU_COLOURS[index]} />
            ))}
          </p>
          <div data-part="plot">
            <canvas data-paint="cpu" />
          </div>
          <footer>{view === undefined ? undefined : <p>{view.cpu.total}</p>}</footer>
        </section>
        <section data-part="half">
          <h4>GPU</h4>
          <p data-part="value">
            {view === undefined ? undefined : <Value value={view.gpu.busy} />}
            {view === undefined ? undefined : <Value value={view.gpu.clock} />}
            {view?.gpu.range === undefined ? undefined : (
              <span data-tag="" title="The GPU driver changes the clock with load (DVFS)">
                {view.gpu.range}
              </span>
            )}
          </p>
          <div data-part="plot">
            <canvas data-paint="gpu" />
          </div>
          <footer>
            {view?.gpu.key === undefined ? undefined : (
              <p data-part="keys">
                <span>
                  <i data-mark="square" data-colour="src" aria-hidden="true" />
                  busy %
                </span>
                <span>
                  <i data-mark="line" data-colour="warn" aria-hidden="true" />
                  {view.gpu.key}
                </span>
              </p>
            )}
            {view?.gpu.note === undefined ? undefined : <p>{view.gpu.note}</p>}
          </footer>
        </section>
      </div>
      {inSelection === undefined ? undefined : (
        <footer>
          <p data-insel>In selection: {inSelection}</p>
        </footer>
      )}
      {off === undefined ? undefined : <OffPanel off={off} onTurnOn={props.onTurnOn} />}
    </article>
  );
}
