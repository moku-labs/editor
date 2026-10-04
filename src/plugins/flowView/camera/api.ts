/**
 * @file flowView camera module — the camera actions (the public `camera` namespace plus the moves
 * the canvas, the minimap and the other modules use). The available rect leaves out the
 * neighbours strip and the pinned preview column; on a narrow canvas the column shrinks so a card
 * still fits.
 */
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, Item, Rect } from "../types";
import { animateTo, applyCamera, cancelAnimation, DURATION } from "./animate";
import {
  centreAt,
  clampZoom,
  defaultCamera,
  FIT_ALL,
  FIT_SELECTION,
  fitRect,
  focusCamera,
  followCamera,
  sideColumn,
  zoomAt
} from "./math";
import type { CameraActions, ViewInsets } from "./types";

/**
 * Height of the open neighbours strip.
 */
export const STRIP_H = 224;

/**
 * Width of the minimap.
 */
export const MINIMAP_W = 200;

/**
 * Width of the pinned preview by size.
 */
const PREVIEW_W = { S: 150, M: 280, L: 340 } as const;

/**
 * Margin around the preview column.
 */
const PREVIEW_MARGIN = 24;

/**
 * The insets of the available rect: the strip at the bottom, the preview column on its corner's
 * side, stored in state for the components. The column is at least the minimap width; on a canvas
 * too narrow for that (a half-screen window) it keeps only the preview clear, and on a narrower
 * one nothing (sideColumn).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The insets.
 */
function insetsOf(ctx: FlowCtx, env: FlowEnvironment): ViewInsets {
  const bottom = ctx.state.focus.strip ? STRIP_H : 0;
  const preview = env.preview();
  const float = PREVIEW_W[preview.size] + PREVIEW_MARGIN;
  const column = Math.max(float, MINIMAP_W + PREVIEW_MARGIN);
  const width = preview.visible ? sideColumn(ctx.state.camera.viewport.w, [column, float]) : 0;
  const onLeft = preview.corner.endsWith("left");
  const insets = { top: 0, right: onLeft ? 0 : width, bottom, left: onLeft ? width : 0 };
  ctx.state.camera.insets = insets;
  return insets;
}

/**
 * The rect of the frame the current node sits in (else the root frame) and the current item.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The frame rect and the current item.
 */
function currentFrame(
  ctx: FlowCtx,
  env: FlowEnvironment
): { readonly frame: Rect | undefined; readonly current: Item | undefined } {
  const result = ctx.state.layout.result;
  if (result === undefined) return { frame: undefined, current: undefined };
  const spot = env.actions().focus.locateCurrent();
  const parent = spot?.item.parent === undefined ? undefined : result.byKey[spot.item.parent];
  return { frame: parent ?? result.bounds, current: spot?.item };
}

/**
 * Creates the camera actions. Fits and focus moves animate over 420 ms, the zoom buttons over
 * 200 ms, Follow moves over 500 ms; pans and wheel zooms apply at once.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The camera actions.
 */
export function createCameraApi(ctx: FlowCtx, env: FlowEnvironment): CameraActions {
  const { camera } = ctx.state;
  const actions: CameraActions = {
    get: () => ({ ...camera.cam }),

    fitAll: () => {
      const result = ctx.state.layout.result;
      if (result === undefined) return;
      const target = fitRect(
        result.bounds,
        camera.viewport,
        insetsOf(ctx, env),
        FIT_ALL.pad,
        FIT_ALL.maxZ,
        ctx.config
      );
      animateTo(ctx, target, DURATION.camera);
    },

    fitSelection: () => {
      const rect = env.actions().focus.relatedRect();
      if (rect === undefined) return;
      const target = fitRect(
        rect,
        camera.viewport,
        insetsOf(ctx, env),
        FIT_SELECTION.pad,
        FIT_SELECTION.maxZ,
        ctx.config
      );
      animateTo(ctx, target, DURATION.camera);
    },

    zoomBy: factor => {
      const target = zoomAt(
        camera.cam,
        camera.viewport.w / 2,
        camera.viewport.h / 2,
        factor,
        ctx.config
      );
      animateTo(ctx, target, DURATION.zoom);
    },

    zoomTo: z => {
      actions.zoomBy(clampZoom(z, ctx.config) / camera.cam.z);
    },

    follow: on => {
      camera.follow = on ?? !camera.follow;
      const spot = camera.follow ? env.actions().focus.locateCurrent() : undefined;
      if (spot !== undefined) actions.followItem(spot.item);
      notify(ctx.state);
      return camera.follow;
    },

    panBy: (dx, dy) => {
      cancelAnimation(ctx);
      camera.cam = { x: camera.cam.x + dx, y: camera.cam.y + dy, z: camera.cam.z };
      applyCamera(ctx);
    },

    zoomAround: (px, py, factor) => {
      cancelAnimation(ctx);
      camera.cam = zoomAt(camera.cam, px, py, factor, ctx.config);
      applyCamera(ctx);
    },

    centreOn: (x, y, animate) => {
      const target = centreAt({ x, y }, camera.cam.z, camera.viewport, insetsOf(ctx, env));
      if (animate) {
        animateTo(ctx, target, DURATION.camera);
        return;
      }
      cancelAnimation(ctx);
      camera.cam = target;
      applyCamera(ctx);
    },

    focusItem: item => {
      animateTo(
        ctx,
        focusCamera(item, camera.cam, camera.viewport, insetsOf(ctx, env)),
        DURATION.camera
      );
    },

    followItem: item => {
      animateTo(
        ctx,
        followCamera(item, camera.cam, camera.viewport, insetsOf(ctx, env)),
        DURATION.follow
      );
    },

    applyDefault: () => {
      if (camera.initialised || camera.viewport.w === 0) return;
      const { frame, current } = currentFrame(ctx, env);
      if (frame === undefined) return;
      cancelAnimation(ctx);
      camera.cam = defaultCamera(frame, current, camera.viewport, insetsOf(ctx, env), ctx.config);
      camera.initialised = true;
      applyCamera(ctx);
    },

    setView: view => {
      camera.viewport = { w: view.w, h: view.h };
      if (!camera.initialised && env.active()) actions.applyDefault();
      else applyCamera(ctx);
    },

    insets: () => insetsOf(ctx, env),

    cancel: () => {
      cancelAnimation(ctx);
    },

    apply: () => {
      applyCamera(ctx);
    },

    run: op => {
      switch (op.kind) {
        case "pan": {
          actions.panBy(op.dx, op.dy);
          break;
        }
        case "zoom": {
          actions.zoomAround(op.px, op.py, op.factor);
          break;
        }
        case "zoomBy": {
          actions.zoomBy(op.factor);
          break;
        }
        case "zoomTo": {
          actions.zoomTo(op.z);
          break;
        }
        default: {
          if (op.target === "all") actions.fitAll();
          else actions.fitSelection();
        }
      }
    }
  };
  return actions;
}
