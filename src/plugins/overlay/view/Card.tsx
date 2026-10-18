/**
 * @file overlay plugin — the card: header, the tab panel, the engine line on the Frames tab, the
 * key bar.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import type { OverlayView } from "../model/types";
import type { OverlayTab } from "../types";
import { EngineLine } from "./EngineLine";
import { FramesTab } from "./FramesTab";
import { GameTab } from "./GameTab";
import { Header } from "./Header";
import { KeyBar } from "./KeyBar";
import { LinkTab } from "./LinkTab";
import { RecordTab } from "./RecordTab";

/**
 * The accessible name of each tab panel.
 */
const PANEL_LABELS: Readonly<Record<OverlayTab, string>> = {
  frames: "Frames",
  game: "Game commands",
  record: "Record",
  link: "Link to the computer"
};

/**
 * The card.
 *
 * @param props - The view and the actions.
 * @param props.view - The overlay view.
 * @param props.actions - The actions.
 * @returns The card.
 */
export function Card(props: {
  readonly view: OverlayView;
  readonly actions: OverlayActions;
}): VNode {
  const { view, actions } = props;
  return (
    <section
      data-overlay="card"
      data-compact={view.compact ? "" : undefined}
      aria-label="Performance overlay"
    >
      <Header header={view.header} dock={view.dock} actions={actions} />
      <div
        role="tabpanel"
        data-tab={view.tab}
        data-view={view.frames?.record === undefined ? undefined : "record"}
        aria-label={PANEL_LABELS[view.tab]}
      >
        {view.frames === undefined ? undefined : (
          <FramesTab frames={view.frames} actions={actions} />
        )}
        {view.game === undefined ? undefined : <GameTab game={view.game} actions={actions} />}
        {view.record === undefined ? undefined : <RecordTab tab={view.record} actions={actions} />}
        {view.link === undefined ? undefined : (
          <LinkTab tab={view.link} engine={view.engine} actions={actions} />
        )}
      </div>
      {view.tab === "frames" ? <EngineLine engine={view.engine} inline={false} /> : undefined}
      <KeyBar
        tabs={view.tabs}
        tab={view.tab}
        rec={view.header.rec}
        linkColour={view.header.link.colour}
        actions={actions}
      />
    </section>
  );
}
