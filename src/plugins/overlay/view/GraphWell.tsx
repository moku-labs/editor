/**
 * @file overlay plugin — the graph row: prev / next with the `n/total` counter, and the well that
 * holds the two canvases (only while the graph shows: the plot, which slides, and the fixed canvas
 * over it, which does not) and the NO GPU TIMER legend.
 */
import type { VNode } from "preact";
import type { OverlayActions } from "../actions";
import { COLOUR } from "../model/format";
import type { FramesView, NavView } from "../model/types";
import { NextIcon, PreviousIcon } from "./icons";
import { Legend, legendOf } from "./Legend";

/**
 * The prev and next keys.
 *
 * @param props - The nav view, the side and the actions.
 * @param props.nav - The nav view.
 * @param props.dir - -1 for previous, 1 for next.
 * @param props.actions - The actions.
 * @returns The key.
 */
export function SpikeNav(props: {
  readonly nav: NavView;
  readonly dir: 1 | -1;
  readonly actions: OverlayActions;
}): VNode {
  const previous = props.dir === -1;
  return (
    <button
      type="button"
      data-spike-nav={previous ? "prev" : "next"}
      aria-label={previous ? "Previous spike" : "Next spike"}
      disabled={props.nav.disabled}
      onClick={() => {
        props.actions.step(props.dir);
      }}
    >
      {previous ? <PreviousIcon /> : <NextIcon />}
    </button>
  );
}

/**
 * The graph row.
 *
 * @param props - The Frames view and the actions.
 * @param props.frames - The Frames view.
 * @param props.actions - The actions.
 * @returns The row.
 */
export function GraphWell(props: {
  readonly frames: FramesView;
  readonly actions: OverlayActions;
}): VNode {
  const { frames, actions } = props;
  return (
    <div data-part="graph-row">
      <div data-part="nav">
        <SpikeNav nav={frames.nav} dir={-1} actions={actions} />
        {frames.compact ? undefined : (
          <span data-part="count" title="Spikes on the graph, last 6 s">
            {frames.nav.counter}
          </span>
        )}
        <SpikeNav nav={frames.nav} dir={1} actions={actions} />
      </div>
      <div data-graph="">
        {frames.state === "graph" ? (
          <>
            <canvas
              ref={actions.canvas}
              aria-label="Frame graph, last 6 seconds"
              onClick={actions.tapGraph}
            />
            <canvas data-fixed="" ref={actions.fixed} />
          </>
        ) : undefined}
        {frames.gpuTimer ? undefined : (
          <Legend
            legend={legendOf(
              "NO GPU TIMER",
              COLOUR.ink2,
              false,
              "This browser exposes no GPU timer"
            )}
          />
        )}
      </div>
    </div>
  );
}
