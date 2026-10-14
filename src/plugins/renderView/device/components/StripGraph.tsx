/**
 * @file renderView device strip — the graph row: the nav column (prev key, the `n/total` counter,
 * next key) and the wide frame graph. The canvas owns the painter's state and the repaint loop:
 * both are made when it mounts and dropped with it (spec 09 § Lifecycle). A click on a flag or a
 * spike bar opens that record; a click elsewhere moves the selection.
 */
import type { VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { RenderViewCtx } from "../../types";
import { createGraphState } from "../contract";
import { clickGraph, startRepaint } from "../paint";
import { STRIP_ROWS } from "../state";
import type { DeviceStripView } from "../types";
import { stepToSpike } from "../watch";
import { Annunciator, TONE_COLOUR } from "./Annunciator";

/**
 * Props of `StripGraph`.
 */
export type StripGraphProps = { readonly ctx: RenderViewCtx; readonly view: DeviceStripView };

/**
 * A chevron mark pointing left (previous) or right (next), 18 px.
 *
 * @param props - The direction.
 * @param props.dir - −1 left, 1 right.
 * @returns The inline SVG.
 */
export function Chevron(props: { readonly dir: 1 | -1 }): VNode {
  const path = props.dir === 1 ? "M7 4l6 6-6 6" : "M13 4l-6 6 6 6";
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}

/**
 * The prev and next keys with the counter between them.
 *
 * @param props - ctx, the view and the `data-part` of the group.
 * @param props.ctx - Domain context of renderView.
 * @param props.view - The strip view.
 * @param props.part - "nav" beside the graph, "record-nav" in the record header.
 * @returns The keys.
 */
export function SpikeKeys(props: {
  readonly ctx: RenderViewCtx;
  readonly view: DeviceStripView;
  readonly part: "nav" | "record-nav";
}): VNode {
  const { ctx, view, part } = props;
  const none = view.counter === "0/0";
  return (
    <div data-part={part}>
      <button
        type="button"
        data-action="prev-spike"
        aria-label="Previous spike"
        disabled={none}
        onClick={() => stepToSpike(ctx, -1)}
      >
        <Chevron dir={-1} />
      </button>
      <span data-part="counter" title="Spikes on the graph, last 6 s">
        {view.counter}
      </span>
      <button
        type="button"
        data-action="next-spike"
        aria-label="Next spike"
        disabled={none}
        onClick={() => stepToSpike(ctx, 1)}
      >
        <Chevron dir={1} />
      </button>
    </div>
  );
}

/**
 * The graph row of the strip.
 *
 * @param props - ctx and the view.
 * @returns The row.
 */
export function StripGraph(props: StripGraphProps): VNode {
  const { ctx, view } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const graph = useMemo(() => createGraphState(STRIP_ROWS), []);
  useEffect(() => startRepaint(ctx, canvas.current, graph), [ctx, graph]);

  /**
   * Hit-tests the click in the canvas's CSS px.
   *
   * @param event - The click.
   */
  const onClick = (event: MouseEvent): void => {
    const target = canvas.current;
    if (target === null) return;
    const box = target.getBoundingClientRect();
    clickGraph(ctx, graph, event.clientX - box.left, event.clientY - box.top);
  };

  return (
    <div data-part="graph-row">
      <SpikeKeys ctx={ctx} view={view} part="nav" />
      <div data-part="graph">
        <canvas
          ref={canvas}
          data-part="canvas"
          aria-label="Frame graph, last 6 seconds"
          onClick={onClick}
        />
        {ctx.state.device.window.gpuTimer ? undefined : (
          <span data-part="no-timer">
            <Annunciator
              text="NO GPU TIMER"
              colour={TONE_COLOUR.ink2}
              title="This browser exposes no GPU timer"
            />
          </span>
        )}
      </div>
    </div>
  );
}
