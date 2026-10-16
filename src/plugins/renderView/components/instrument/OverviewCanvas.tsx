/**
 * @file renderView components (instrument) — the 2-minute overview scrubber (spec 09 § M8): the
 * canvas the loop paints (`data-paint="overview"`, focusable, the timeline's keys). A press inside the
 * viewport keeps its grab offset, elsewhere centres the viewport on the pointer; the drag pauses and
 * moves the view's end; a release within 250 ms of the live edge returns to live.
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { grabOffset, overviewTime } from "../../timeline/hit";
import type { TimelineLayout } from "../../timeline/layout";
import { boxLayout } from "../../timeline/layout";
import { paintedScene } from "../../timeline/loop";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { handlePlotKey } from "./usePlotPointer";

/**
 * Props of `OverviewCanvas`.
 */
export type OverviewCanvasProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/** A release this close to the live edge, ms, goes back to live. */
const LIVE_SNAP_MS = 250;

/**
 * The overview's geometry and the pointer's x in it.
 *
 * @param event - The pointer event on the canvas.
 * @returns The layout and x, CSS px.
 */
function placeOf(event: PointerEvent): { readonly layout: TimelineLayout; readonly x: number } {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    layout: boxLayout(rect.width, rect.height, globalThis.devicePixelRatio || 1),
    x: event.clientX - rect.left
  };
}

/**
 * The overview scrubber.
 *
 * @param props - ctx and the api.
 * @returns The plot.
 */
export function OverviewCanvas(props: OverviewCanvasProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const [offset, setOffset] = useState<number>();

  const onPointerDown = (event: PointerEvent): void => {
    const scene = paintedScene(mission);
    if (scene === undefined || mission.history.count === 0 || event.button !== 0) return;
    const { layout, x } = placeOf(event);
    const grab = grabOffset(layout, x, scene);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setOffset(grab);
    api.seek(overviewTime(layout, x, scene.liveEndMs) + grab);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const scene = paintedScene(mission);
    if (offset === undefined || scene === undefined) return;
    const { layout, x } = placeOf(event);
    api.seek(overviewTime(layout, x, scene.liveEndMs) + offset);
  };

  const onPointerUp = (): void => {
    if (offset === undefined) return;
    setOffset(undefined);
    const scene = paintedScene(mission);
    if (scene !== undefined && scene.liveEndMs - mission.view.endMs < LIVE_SNAP_MS) api.live();
  };

  return (
    <div data-plot="overview" data-grabbing={offset === undefined ? undefined : ""}>
      <canvas
        data-paint="overview"
        tabIndex={0}
        aria-label="Overview of the last 2 minutes. Drag the window to rewind."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={event => handlePlotKey(ctx, api, event)}
      />
    </div>
  );
}
