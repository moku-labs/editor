/**
 * @file renderView components (instrument) — the pointer and the keys of the frame plots (spec 09 §
 * M8, M11): a press on a spike flag selects its group; a press on a bar pauses the view, a click
 * selects that frame and a drag of more than 3 px a range (drawn while it is dragged); every move puts
 * the shared cursor at the time under the pointer; ← → step a frame, Shift + ← → jump to a spike
 * group, Space pauses or goes live, Esc closes a popover before it clears the selection.
 */
import { useState } from "preact/hooks";
import { closePopover } from "../../actions/popover";
import { notifyMission } from "../../state";
import { flagAt, frameAt } from "../../timeline/hit";
import type { TimelineLayout } from "../../timeline/layout";
import { framesLayout, laneLayout } from "../../timeline/layout";
import { paintedScene } from "../../timeline/loop";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { clearHover, setHover } from "../../view/hover";
import { keyOf } from "../../view/keys";
import { dragSelection, rangeOfDrag } from "../../view/selection";
import { viewWindow } from "../../view/view";

/** A press in progress: where it started and the frame under it. */
type Press = { readonly x: number; readonly frame: number };

/**
 * The view the plot shows: the last painted one, or the view now before the loop painted.
 *
 * @param ctx - Domain context of renderView.
 * @returns The start and span.
 */
function shownView(ctx: RenderViewCtx): { readonly startMs: number; readonly span: number } {
  const { mission } = ctx.state;
  const scene = paintedScene(mission);
  if (scene !== undefined) return { startMs: scene.endMs - scene.span, span: scene.span };
  const window = viewWindow(mission, performance.now());
  return { startMs: window.startMs, span: mission.view.span };
}

/**
 * The plot's geometry and the pointer's x and y in it.
 *
 * @param event - The pointer event on the canvas.
 * @param kind - The timeline or the lane.
 * @returns The layout and the position, CSS px.
 */
function placeOf(
  event: PointerEvent,
  kind: "timeline" | "lane"
): { readonly layout: TimelineLayout; readonly x: number; readonly y: number } {
  const canvas = event.currentTarget as HTMLElement;
  const rect = canvas.getBoundingClientRect();
  const dpr = globalThis.devicePixelRatio || 1;
  const layout =
    kind === "timeline"
      ? framesLayout(rect.width, rect.height, dpr)
      : laneLayout(rect.width, rect.height, dpr);
  return { layout, x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Handles a key on a focused plot (the timeline or the overview).
 *
 * @param ctx - Domain context of renderView.
 * @param api - The renderView api.
 * @param event - The keydown.
 * @example
 * ```ts
 * <canvas tabIndex={0} onKeyDown={event => handlePlotKey(ctx, api, event)} />
 * ```
 */
export function handlePlotKey(ctx: RenderViewCtx, api: RenderViewApi, event: KeyboardEvent): void {
  const { mission } = ctx.state;
  const key = keyOf(event, mission.popover !== undefined);
  if (key === undefined) return;
  event.preventDefault();
  switch (key.kind) {
    case "step": {
      api.step(key.dir);
      return;
    }
    case "jump": {
      api.jump("spike", key.dir);
      return;
    }
    case "toggle-live": {
      if (mission.view.live) api.pause();
      else api.live();
      return;
    }
    case "close-popover": {
      closePopover(mission);
      notifyMission(mission);
      return;
    }
    default: {
      // eslint-disable-next-line unicorn/no-useless-undefined -- select(undefined) clears the selection (the api's contract)
      api.select(undefined);
    }
  }
}

/**
 * The pointer handlers of a frame plot.
 *
 * @example
 * ```ts
 * const pointer: PlotPointer = usePlotPointer(ctx, api, "timeline");
 * pointer.dragging; // true while a press is held
 * ```
 */
export type PlotPointer = {
  readonly dragging: boolean;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerUp: (event: PointerEvent) => void;
  readonly onPointerLeave: () => void;
};

/**
 * The pointer of the timeline (with its spike flags) or the lane.
 *
 * @param ctx - Domain context of renderView.
 * @param api - The renderView api.
 * @param kind - Which plot.
 * @returns The handlers and whether a press is held.
 */
export function usePlotPointer(
  ctx: RenderViewCtx,
  api: RenderViewApi,
  kind: "timeline" | "lane"
): PlotPointer {
  const { mission } = ctx.state;
  const [press, setPress] = useState<Press>();

  const frameUnder = (layout: TimelineLayout, x: number): number | undefined => {
    const { startMs, span } = shownView(ctx);
    return frameAt(mission.history, layout, x, startMs, span);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (mission.history.count === 0 || event.button !== 0) return;
    const { layout, x, y } = placeOf(event, kind);
    const scene = paintedScene(mission);
    const flag = kind === "timeline" && scene !== undefined ? flagAt(scene.hits, x, y) : -1;
    if (scene !== undefined && flag >= 0) {
      api.select({ from: scene.hits.from[flag] ?? 0, to: scene.hits.to[flag] ?? 0 });
      return;
    }
    const frame = frameUnder(layout, x);
    if (frame === undefined) return;
    api.pause();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setPress({ x, frame });
  };

  const onPointerMove = (event: PointerEvent): void => {
    const { layout, x } = placeOf(event, kind);
    const { startMs, span } = shownView(ctx);
    const inside = Math.min(layout.plot.w, Math.max(0, x));
    const t = startMs + (inside / layout.plot.w) * span;
    const frame = frameUnder(layout, inside);
    setHover(mission, x <= layout.plot.w ? t : undefined, frame);
    if (press === undefined || frame === undefined) return;
    dragSelection(mission, rangeOfDrag(press.frame, frame, Math.abs(x - press.x)));
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (press === undefined) return;
    const { layout, x } = placeOf(event, kind);
    const frame = frameUnder(layout, Math.min(layout.plot.w, Math.max(0, x))) ?? press.frame;
    setPress(undefined);
    api.select(rangeOfDrag(press.frame, frame, Math.abs(x - press.x)));
  };

  const onPointerLeave = (): void => {
    if (press === undefined) clearHover(mission);
  };

  return {
    dragging: press !== undefined,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave
  };
}
