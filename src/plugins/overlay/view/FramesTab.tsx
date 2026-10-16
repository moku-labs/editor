/**
 * @file overlay plugin — the Frames tab: the graph row, the waiting or no-monitor note, the offline
 * note, the counters and More; or the spike record.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { FramesView } from "../model/types";
import { Counters } from "./Counters";
import { GraphWell } from "./GraphWell";
import { Legend, legendOf } from "./Legend";
import { SpikeRecord } from "./SpikeRecord";

/**
 * The Frames tab.
 *
 * @param props - The Frames view and the actions.
 * @param props.frames - The Frames view.
 * @param props.actions - The actions.
 * @returns The tab's content.
 */
export function FramesTab(props: {
  readonly frames: FramesView;
  readonly actions: OverlayActions;
}): VNode {
  const { frames, actions } = props;
  if (frames.record !== undefined) return <SpikeRecord record={frames.record} actions={actions} />;
  if (frames.state === "off") return <p data-part="note">{frames.note}</p>;

  return (
    <>
      <GraphWell frames={frames} actions={actions} />
      {frames.state === "waiting" ? <p data-part="note">{frames.note}</p> : undefined}
      {frames.offline ? (
        <p data-part="offnote">
          <Legend legend={legendOf("NO PC", COLOUR.ink)} />
          <span>Logs stay on the phone, they are sent when a computer connects.</span>
        </p>
      ) : undefined}
      <Counters frames={frames} actions={actions} />
    </>
  );
}
