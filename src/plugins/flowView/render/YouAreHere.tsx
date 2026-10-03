/**
 * @file flowView render module — "You are here" (F7): a floating accent tag with the current node
 * id when the current item is off-screen, within 8 px of an edge, the zoom is under 55 % or it is
 * inside a collapsed parent; clamped inside the available rect; a click focuses the current node.
 */
import type { VNode } from "preact";
import type { ViewInsets, ViewSize } from "../camera/types";
import type { Camera, FlowActions, FlowCtx, Item } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Margin of the edge rule and of the clamp.
 */
const EDGE = 8;

/**
 * Below this zoom the tag always shows.
 */
const SMALL_ZOOM = 0.55;

/**
 * Room kept for the tag when it is clamped.
 */
const TAG = { w: 220, h: 26 } as const;

/**
 * Props of `YouAreHere`.
 */
export type YouAreHereProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * Whether and where the tag shows.
 *
 * @param item - The current item (its id is the current node id).
 * @param inside - The collapsed parent the current node is inside.
 * @param cam - The camera.
 * @param view - The viewport size.
 * @param insets - The insets of the available rect.
 * @returns Whether it shows, its top-left in canvas px and its label.
 * @example
 * ```ts
 * youAreHereTag(item, undefined, { x: 0, y: 0, z: 0.5 }, view, insets).show; // true (under 55 %)
 * ```
 */
export function youAreHereTag(
  item: Item,
  inside: string | undefined,
  cam: Camera,
  view: ViewSize,
  insets: ViewInsets
): { readonly show: boolean; readonly x: number; readonly y: number; readonly label: string } {
  const left = item.x * cam.z + cam.x;
  const top = item.y * cam.z + cam.y;
  const right = left + item.w * cam.z;
  const bottom = top + item.h * cam.z;
  const area = {
    left: insets.left,
    top: insets.top,
    right: view.w - insets.right,
    bottom: view.h - insets.bottom
  };
  const off = right < area.left || left > area.right || bottom < area.top || top > area.bottom;
  const edge =
    left < area.left + EDGE ||
    top < area.top + EDGE ||
    right > area.right - EDGE ||
    bottom > area.bottom - EDGE;
  const show = off || edge || cam.z < SMALL_ZOOM || inside !== undefined;
  const x = Math.min(
    Math.max(left, area.left + EDGE),
    Math.max(area.left + EDGE, area.right - EDGE - TAG.w)
  );
  const y = Math.min(
    Math.max(top - TAG.h - 4, area.top + EDGE),
    Math.max(area.top + EDGE, area.bottom - EDGE - TAG.h)
  );
  return { show, x, y, label: inside === undefined ? item.id : `${item.id} (inside ${inside})` };
}

/**
 * The "You are here" tag.
 *
 * @param props - Context and actions.
 * @returns The tag, or an empty fragment when it does not show.
 * @example
 * ```tsx
 * <YouAreHere ctx={ctx} actions={actions} />
 * ```
 */
export function YouAreHere(props: YouAreHereProps): VNode {
  const { ctx, actions } = props;
  useFlowStore(ctx, state => state.camera.cam, "camera");
  useFlowStore(ctx, state => state.view.revision);
  const spot = actions.focus.locateCurrent();
  const current = actions.focus.current();
  if (spot === undefined || current === undefined)
    return <span data-closed="you-are-here" hidden />;
  const { camera } = ctx.state;
  const tag = youAreHereTag(
    { ...spot.item, id: current },
    spot.inside,
    camera.cam,
    camera.viewport,
    camera.insets
  );
  if (!tag.show) return <span data-closed="you-are-here" hidden />;
  return (
    <button
      type="button"
      data-flow="you-are-here"
      data-chrome=""
      style={{ left: `${tag.x}px`, top: `${tag.y}px` }}
      onClick={() => actions.focus.select(current)}
    >
      {tag.label}
    </button>
  );
}
