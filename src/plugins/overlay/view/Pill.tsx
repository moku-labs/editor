/**
 * @file overlay plugin — the pill (C1): the link light, fps, REC, the spikes legend. A tap opens
 * the card.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { OverlayView } from "../model/types";
import { Legend, legendOf } from "./Legend";

/**
 * The pill.
 *
 * @param props - The view and the actions.
 * @param props.view - The overlay view.
 * @param props.actions - The actions.
 * @returns The pill.
 */
export function Pill(props: {
  readonly view: OverlayView;
  readonly actions: OverlayActions;
}): VNode {
  const { header } = props.view;
  return (
    <button
      type="button"
      data-overlay="pill"
      aria-label={props.view.pillLabel}
      onClick={props.actions.openCard}
    >
      <span data-part="light" data-link={header.link.kind} style={`--c: ${header.link.colour}`} />
      <b data-part="fps">{header.fps}</b>
      <span data-part="labels">
        {header.fpsUnit === "" ? undefined : <span>{header.fpsUnit}</span>}
        {header.rec ? (
          <span data-part="rec" data-rec="">
            <i />
            REC
          </span>
        ) : undefined}
      </span>
      <Legend legend={legendOf(String(header.spikes), COLOUR.caution)} glyph />
      <span data-part="labels">
        <span>spikes</span>
        <span>6 s</span>
      </span>
    </button>
  );
}
