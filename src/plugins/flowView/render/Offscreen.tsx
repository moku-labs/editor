/**
 * @file flowView render module — the off-screen chevron (finding 16): while the current node is
 * outside the visible canvas, a chevron on the canvas edge points towards it; a click shows where
 * the game is (Find current). It follows the camera.
 */
import type { VNode } from "preact";
import type { ViewInsets, ViewSize } from "../camera/types";
import type { Camera, FlowActions, FlowCtx, Rect } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Distance of the chevron's centre from the canvas edge, in px.
 */
const EDGE = 22;

/**
 * Props of `Offscreen`.
 */
export type OffscreenProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * Where the chevron sits: on the edge of the available rect, on the line from its centre to the
 * item's centre, turned to point along it; undefined while any part of the item is in view.
 *
 * @param item - The current item's world rect.
 * @param cam - The camera.
 * @param view - The viewport size.
 * @param insets - The insets of the available rect.
 * @returns The chevron centre in canvas px and its angle in degrees (0 = right), or undefined.
 * @example
 * ```ts
 * offscreenSpot({ x: 5000, y: 300, w: 172, h: 44 }, { x: 0, y: 0, z: 1 }, { w: 1200, h: 800 }, { top: 0, right: 0, bottom: 0, left: 0 });
 * // { x: 1178, y: 389.95…, angle: -0.99… }: on the right edge, pointing right
 * ```
 */
export function offscreenSpot(
  item: Rect,
  cam: Camera,
  view: ViewSize,
  insets: ViewInsets
): { readonly x: number; readonly y: number; readonly angle: number } | undefined {
  const area = {
    left: insets.left,
    top: insets.top,
    right: view.w - insets.right,
    bottom: view.h - insets.bottom
  };
  const left = item.x * cam.z + cam.x;
  const top = item.y * cam.z + cam.y;
  const right = left + item.w * cam.z;
  const bottom = top + item.h * cam.z;
  const isVisible =
    right > area.left && left < area.right && bottom > area.top && top < area.bottom;
  if (isVisible || area.right - area.left <= 2 * EDGE || area.bottom - area.top <= 2 * EDGE) {
    return undefined;
  }

  // From the centre of the area towards the item, scaled onto the area's inner edge.
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  const dx = (left + right) / 2 - cx;
  const dy = (top + bottom) / 2 - cy;
  const halfW = (area.right - area.left) / 2 - EDGE;
  const halfH = (area.bottom - area.top) / 2 - EDGE;
  const scale = Math.min(
    halfW / Math.max(Math.abs(dx), 1e-6),
    halfH / Math.max(Math.abs(dy), 1e-6)
  );
  return { x: cx + dx * scale, y: cy + dy * scale, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * The off-screen chevron.
 *
 * @param props - Context and actions.
 * @returns The chevron, or an empty fragment while the current node is in view.
 */
export function Offscreen(props: OffscreenProps): VNode {
  const { ctx, actions } = props;
  useFlowStore(ctx, state => state.camera.cam, "camera");
  useFlowStore(ctx, state => state.view.revision);
  const spot = actions.focus.locateCurrent();
  const { camera } = ctx.state;
  const place =
    spot === undefined
      ? undefined
      : offscreenSpot(spot.item, camera.cam, camera.viewport, camera.insets);
  if (place === undefined) return <span data-closed="offscreen" hidden />;
  return (
    <button
      type="button"
      data-flow="offscreen"
      data-chrome=""
      title="Show where the game is (C)"
      aria-label="Show where the game is"
      style={{
        left: `${place.x}px`,
        top: `${place.y}px`,
        "--flow-offscreen-angle": `${place.angle}deg`
      }}
      onClick={() => actions.focus.findCurrent()}
    >
      <span data-part="chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
