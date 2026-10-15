/**
 * @file overlay plugin — the card header (B1): grip, fps, the spikes legend, the link legend (or
 * STALE), REC, collapse and hide.
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
 * The header.
 *
 * @param props - The header view, the dock and the actions.
 * @returns The header row.
 */
export function Header(props: HeaderProps): VNode {
  const { header, actions } = props;
  const spikes = `${header.spikes} spikes, 6 s`;
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
      <span data-part="fps">
        <b>{header.fps}</b>
        <small>fps</small>
      </span>
      <span data-part="spikes" title={spikes}>
        <Legend legend={legendOf(String(header.spikes), COLOUR.caution, false, spikes)} glyph />
        <span data-part="spikes-label">
          spikes
          <br />6 s
        </span>
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
      {header.rec ? (
        <Legend legend={legendOf("REC", COLOUR.warning, true, "Recording")} rec />
      ) : undefined}
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
