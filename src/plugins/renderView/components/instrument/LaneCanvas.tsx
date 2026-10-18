/**
 * @file renderView components (instrument) — the Shaders & passes lane under the timeline, on the same
 * time axis (spec 09 § M8): the canvas the loop paints (`data-paint="lane"`); hovering moves the shared
 * cursor, a click selects one frame and a drag a range.
 */
import type { JSX } from "preact";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { usePlotPointer } from "./usePlotPointer";

/**
 * Props of `LaneCanvas`.
 */
export type LaneCanvasProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * The Shaders & passes lane.
 *
 * @param props - ctx and the api.
 * @returns The plot.
 */
export function LaneCanvas(props: LaneCanvasProps): JSX.Element {
  const { ctx, api } = props;
  const pointer = usePlotPointer(ctx, api, "lane");
  return (
    <div data-plot="lane">
      <canvas
        data-paint="lane"
        aria-label="Shaders and passes per frame, on the same time axis as the frames. Click to inspect a frame."
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.onPointerUp}
        onPointerLeave={pointer.onPointerLeave}
      />
    </div>
  );
}
