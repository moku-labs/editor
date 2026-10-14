/**
 * @file renderView device strip — the device row (D1): the model and its about line, then the
 * cells backend, engine fingerprint (STALE against the computer's), build with its profile, link
 * (ADB / LAN with the endpoint, BROWSER on a browser session) and log (REC with the recorder's
 * clock; absent without the recorder source). No rate cell: the rate is the `@120` suffix of the
 * headline's drawn / loop.
 */
import type { ComponentChildren, VNode } from "preact";
import type { LinkStatus } from "../../../registry/protocol";
import { DASH, linkCell, recCell } from "../derive";
import type { DeviceStripView } from "../types";
import { Annunciator, TONE_COLOUR } from "./Annunciator";

/**
 * Props of `DeviceRow`.
 */
export type DeviceRowProps = { readonly view: DeviceStripView; readonly status: LinkStatus };

/**
 * One cell of the row: a small label over its value line.
 *
 * @param props - The label, the cell name and the value line.
 * @param props.label - "backend", "engine fingerprint", …
 * @param props.name - The `data-cell` name.
 * @param props.children - The value line.
 * @returns The cell.
 */
function Cell(props: {
  readonly label: string;
  readonly name: string;
  readonly children: ComponentChildren;
}): VNode {
  return (
    <div data-cell={props.name}>
      <span data-part="label">{props.label}</span>
      <span data-part="value">{props.children}</span>
    </div>
  );
}

/**
 * The engine cell: the phone's id in amber with the lit STALE legend and "computer has …" when
 * the fingerprints differ; else the known id in ink, or "—".
 *
 * @param props - The view's engine.
 * @param props.engine - Device and computer ids and whether they differ.
 * @returns The value line.
 */
function EngineValue(props: { readonly engine: DeviceStripView["engine"] }): VNode {
  const { device, computer, stale } = props.engine;
  if (!stale) return <span data-part="engine-id">{device ?? computer ?? DASH}</span>;
  return (
    <>
      <span data-part="engine-id" data-tone="amber">
        {device}
      </span>
      <Annunciator text="STALE" colour={TONE_COLOUR.amber} lit />
      <em>computer has {computer}</em>
    </>
  );
}

/**
 * The device row.
 *
 * @param props - The strip view and the link status (silent or lost marks the link cell).
 * @returns The row.
 */
export function DeviceRow(props: DeviceRowProps): VNode {
  const { view, status } = props;
  const link = linkCell(view.link, view.seenSeconds, status);
  const rec = recCell(view.rec);
  return (
    <div data-part="device-row">
      <div data-part="model">
        <span data-part="model-name">{view.model ?? DASH}</span>
        <span data-part="about">{view.about}</span>
      </div>
      <Cell label="backend" name="backend">
        <span data-tone="cyan">{view.backend ?? DASH}</span>
      </Cell>
      <Cell label="engine fingerprint" name="engine">
        <EngineValue engine={view.engine} />
      </Cell>
      <Cell label="build" name="build">
        {view.build.id ?? DASH}
        {view.build.profile === undefined ? undefined : <em>{view.build.profile}</em>}
      </Cell>
      <Cell label="link" name="link">
        <Annunciator text={link.legend} colour={TONE_COLOUR[link.tone]} />
        <em>{link.text}</em>
      </Cell>
      {rec === undefined ? undefined : (
        <Cell label="log" name="log">
          <Annunciator text={rec.text} colour={TONE_COLOUR[rec.tone]} lit={rec.lit} />
        </Cell>
      )}
    </div>
  );
}
