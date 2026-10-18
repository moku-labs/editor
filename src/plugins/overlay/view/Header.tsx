/**
 * @file overlay plugin — the card header (B1): grip, fps, the spikes legend, the link legend (or
 * STALE), REC, collapse and hide. The compact card's header (spec 08 delta item 8) leaves out the
 * fps unit and the spikes label and shows REC as a red dot and its time.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { HeaderView } from "../model/types";
import type { Dock } from "../types";
import { CollapseIcon, GripIcon, HideIcon } from "./icons";
import { Legend, legendOf } from "./Legend";

/**
 * Props of `Header`.
 */
export type HeaderProps = {
  readonly header: HeaderView;
  readonly dock: Dock;
  readonly actions: OverlayActions;
};

/**
 * The recording mark: the REC legend, or on the compact card a red dot and the time (named REC).
 *
 * @param props - The header view.
 * @param props.header - The header view.
 * @returns The mark.
 */
function RecMark(props: { readonly header: HeaderView }): VNode {
  const { header } = props;
  if (!header.compact) {
    return <Legend legend={legendOf("REC", COLOUR.warning, true, "Recording")} rec />;
  }
  return (
    <span
      data-part="rec-dot"
      data-rec=""
      role="img"
      aria-label={`REC ${header.recFor}`}
      title={`Recording, ${header.recFor}`}
    >
      <i />
      {header.recFor}
    </span>
  );
}

/**
 * The header.
 *
 * @param props - The header view, the dock and the actions.
 * @returns The header row.
 */
export function Header(props: HeaderProps): VNode {
  const { header, actions } = props;
  const spikes = `${header.spikes} spikes, 6 s`;
  const unit = header.compact ? "" : header.fpsUnit;
  return (
    <div data-part="header">
      <button
        type="button"
        data-part="grip"
        aria-label="Move the overlay. Up and down move it, left and right pick the edge."
        title="Drag to move, snaps to the left or right edge"
        onPointerDown={actions.gripDown}
        onPointerMove={actions.gripMove}
        onPointerUp={actions.gripUp}
        onPointerCancel={actions.gripUp}
        onKeyDown={actions.gripKey}
      >
        <GripIcon />
      </button>
      <span
        data-part="fps"
        title={
          header.compact && header.fpsUnit !== "" ? `${header.fps} ${header.fpsUnit}` : undefined
        }
      >
        <b>{header.fps}</b>
        {unit === "" ? undefined : <small>{unit}</small>}
      </span>
      <span data-part="spikes" title={spikes}>
        <Legend legend={legendOf(String(header.spikes), COLOUR.caution, false, spikes)} glyph />
        {header.compact ? undefined : (
          <span data-part="spikes-label">
            spikes
            <br />6 s
          </span>
        )}
      </span>
      {header.stale ? (
        <Legend
          legend={legendOf(
            "STALE",
            COLOUR.caution,
            true,
            "The phone runs another engine than the computer"
          )}
          link="stale"
        />
      ) : (
        <Legend
          legend={legendOf(header.link.text, header.link.colour, false, "Link to the computer")}
          link={header.link.kind}
        />
      )}
      {header.rec ? <RecMark header={header} /> : undefined}
      <span data-part="spacer" />
      <button
        type="button"
        data-action="collapse"
        aria-label="Collapse to the pill"
        onClick={actions.collapse}
      >
        <CollapseIcon dock={props.dock} />
      </button>
      <button type="button" data-action="hide" aria-label="Hide the overlay" onClick={actions.hide}>
        <HideIcon />
      </button>
    </div>
  );
}
