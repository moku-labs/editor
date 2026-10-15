/**
 * @file overlay plugin — the key bar (B2): Frames, Game (only with overlay commands), Record (a red
 * dot while recording), Link (a dot in the link colour).
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { OverlayTab } from "../types";

/**
 * The key labels.
 */
const LABELS: Readonly<Record<OverlayTab, string>> = {
  frames: "Frames",
  game: "Game",
  record: "Record",
  link: "Link"
};

/**
 * Props of `KeyBar`.
 */
export type KeyBarProps = {
  readonly tabs: readonly OverlayTab[];
  readonly tab: OverlayTab;
  readonly rec: boolean;
  readonly linkColour: string;
  readonly actions: OverlayActions;
};

/**
 * The key bar.
 *
 * @param props - The tabs, the current tab, REC, the link colour and the actions.
 * @returns The tablist.
 */
export function KeyBar(props: KeyBarProps): VNode {
  return (
    <div role="tablist" aria-label="Overlay tabs" data-count={String(props.tabs.length)}>
      {props.tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          data-tab={tab}
          aria-selected={tab === props.tab}
          onClick={() => {
            props.actions.tab(tab);
          }}
        >
          {LABELS[tab]}
          {tab === "record" && props.rec ? (
            <i data-part="dot" data-rec="" style={`--c: ${COLOUR.warning}`} />
          ) : undefined}
          {tab === "link" ? <i data-part="dot" style={`--c: ${props.linkColour}`} /> : undefined}
        </button>
      ))}
    </div>
  );
}
