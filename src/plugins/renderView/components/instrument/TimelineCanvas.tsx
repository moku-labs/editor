/**
 * @file renderView components (instrument) — the frame timeline (spec 09 § M8): the canvas the loop
 * paints (`data-paint="timeline"`, focusable, its keys), its pointer (flags, click, drag, the shared
 * cursor), the empty overlay and the hover tooltip while the pointer is over it.
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { EmptyOverlay } from "./EmptyOverlay";
import { Tooltip } from "./Tooltip";
import { handlePlotKey, usePlotPointer } from "./usePlotPointer";

/**
 * Props of `TimelineCanvas`.
 */
export type TimelineCanvasProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/** The timeline's accessible name (spec 09 § M8). */
const LABEL =
  "Frame timeline. Drag to select a range, click a frame, arrow keys step frames, Shift arrows jump spikes, Space pauses.";

/**
 * The frame timeline.
 *
 * @param props - ctx and the api.
 * @returns The plot.
 */
export function TimelineCanvas(props: TimelineCanvasProps): JSX.Element {
  const { ctx, api } = props;
  const pointer = usePlotPointer(ctx, api, "timeline");
  const [width, setWidth] = useState(0);
  const [over, setOver] = useState(false);
  return (
    <div data-plot="timeline">
      <canvas
        data-paint="timeline"
        tabIndex={0}
        aria-label={LABEL}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={event => {
          const box = event.currentTarget.getBoundingClientRect().width;
          if (box !== width) setWidth(box);
          if (!over) setOver(true);
          pointer.onPointerMove(event);
        }}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.onPointerUp}
        onPointerLeave={() => {
          setOver(false);
          pointer.onPointerLeave();
        }}
        onKeyDown={event => handlePlotKey(ctx, api, event)}
      />
      <EmptyOverlay ctx={ctx} />
      {over ? <Tooltip ctx={ctx} dragging={pointer.dragging} width={width} /> : undefined}
    </div>
  );
}
