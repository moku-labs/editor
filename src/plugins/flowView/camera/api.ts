/**
 * @file flowView camera module — the camera actions (the public `camera` namespace plus the moves
 * the canvas, the minimap and the other modules use). The available rect leaves out the
 * neighbours strip and the pinned preview column.
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
  zoomAt
} from "./math";
import type { CameraActions, CameraOp, ViewInsets } from "./types";

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
 * side (at least the minimap width), stored in state for the components.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The insets.
 * @example
 * ```ts
 * insetsOf(ctx, env); // { top: 0, right: 224, bottom: 224, left: 0 }
 * ```
 */
function insetsOf(ctx: FlowCtx, env: FlowEnvironment): ViewInsets {
  const bottom = ctx.state.focus.strip ? STRIP_H : 0;
  const preview = env.preview();
  const width = preview.visible
    ? Math.max(PREVIEW_W[preview.size] + PREVIEW_MARGIN, MINIMAP_W + PREVIEW_MARGIN)
    : 0;
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
 * @example
 * ```ts
 * currentFrame(ctx, env).frame; // the board frame while the game waits on the board
 * ```
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
 * Creates the camera actions.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The camera actions.
 * @example
 * ```ts
 * createCameraApi(ctx, env).zoomBy(1.25);
 * ```
 */
export function createCameraApi(ctx: FlowCtx, env: FlowEnvironment): CameraActions {
  const { camera } = ctx.state;
  const actions: CameraActions = {
    /**
     * A copy of the camera.
     *
     * @returns The camera.
     * @example
     * ```ts
     * actions.camera.get().z; // 1
     * ```
     */
    get() {
      return { ...camera.cam };
    },

    /**
     * Fits the root frame, 420 ms.
     *
     * @example
     * ```ts
     * actions.camera.fitAll();
     * ```
     */
    fitAll() {
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

    /**
     * Fits the selection and its neighbours (or the current node), 420 ms.
     *
     * @example
     * ```ts
     * actions.camera.fitSelection();
     * ```
     */
    fitSelection() {
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

    /**
     * Zooms by a factor around the viewport centre, 200 ms.
     *
     * @param factor - The factor.
     * @example
     * ```ts
     * actions.camera.zoomBy(0.8);
     * ```
     */
    zoomBy(factor: number) {
      const target = zoomAt(
        camera.cam,
        camera.viewport.w / 2,
        camera.viewport.h / 2,
        factor,
        ctx.config
      );
      animateTo(ctx, target, DURATION.zoom);
    },

    /**
     * Sets an absolute zoom around the viewport centre, 200 ms.
     *
     * @param z - The zoom.
     * @example
     * ```ts
     * actions.camera.zoomTo(1);
     * ```
     */
    zoomTo(z: number) {
      actions.zoomBy(clampZoom(z, ctx.config) / camera.cam.z);
    },

    /**
     * Toggles or sets Follow; turning it on moves to the current node (500 ms).
     *
     * @param on - The new value; omitted = toggle.
     * @returns The new value.
     * @example
     * ```ts
     * actions.camera.follow(); // true
     * ```
     */
    follow(on?: boolean) {
      camera.follow = on ?? !camera.follow;
      const spot = camera.follow ? env.actions().focus.locateCurrent() : undefined;
      if (spot !== undefined) actions.followItem(spot.item);
      notify(ctx.state);
      return camera.follow;
    },

    /**
     * Pans by screen px at once.
     *
     * @param dx - Horizontal px.
     * @param dy - Vertical px.
     * @example
     * ```ts
     * actions.camera.panBy(-40, 0);
     * ```
     */
    panBy(dx: number, dy: number) {
      cancelAnimation(ctx);
      camera.cam = { x: camera.cam.x + dx, y: camera.cam.y + dy, z: camera.cam.z };
      applyCamera(ctx);
    },

    /**
     * Zooms around a screen point at once.
     *
     * @param px - Canvas x.
     * @param py - Canvas y.
     * @param factor - The factor.
     * @example
     * ```ts
     * actions.camera.zoomAround(300, 200, 1.1);
     * ```
     */
    zoomAround(px: number, py: number, factor: number) {
      cancelAnimation(ctx);
      camera.cam = zoomAt(camera.cam, px, py, factor, ctx.config);
      applyCamera(ctx);
    },

    /**
     * Centres a world point, animated or live.
     *
     * @param x - World x.
     * @param y - World y.
     * @param animate - True for a 420 ms move (minimap click), false for a live drag.
     * @example
     * ```ts
     * actions.camera.centreOn(640, 480, true);
     * ```
     */
    centreOn(x: number, y: number, animate: boolean) {
      const target = centreAt({ x, y }, camera.cam.z, camera.viewport, insetsOf(ctx, env));
      if (animate) {
        animateTo(ctx, target, DURATION.camera);
        return;
      }
      cancelAnimation(ctx);
      camera.cam = target;
      applyCamera(ctx);
    },

    /**
     * Focus move onto an item, 420 ms.
     *
     * @param item - The item.
     * @example
     * ```ts
     * actions.camera.focusItem(item);
     * ```
     */
    focusItem(item: Item) {
      animateTo(
        ctx,
        focusCamera(item, camera.cam, camera.viewport, insetsOf(ctx, env)),
        DURATION.camera
      );
    },

    /**
     * Follow move onto an item, 500 ms.
     *
     * @param item - The current item.
     * @example
     * ```ts
     * actions.camera.followItem(item);
     * ```
     */
    followItem(item: Item) {
      animateTo(
        ctx,
        followCamera(item, camera.cam, camera.viewport, insetsOf(ctx, env)),
        DURATION.follow
      );
    },

    /**
     * Applies the default camera once per root (M11), without a tween.
     *
     * @example
     * ```ts
     * actions.camera.applyDefault();
     * ```
     */
    applyDefault() {
      if (camera.initialised || camera.viewport.w === 0) return;
      const { frame, current } = currentFrame(ctx, env);
      if (frame === undefined) return;
      cancelAnimation(ctx);
      camera.cam = defaultCamera(frame, current, camera.viewport, insetsOf(ctx, env), ctx.config);
      camera.initialised = true;
      applyCamera(ctx);
    },

    /**
     * Records the canvas size.
     *
     * @param view - Width and height in px.
     * @example
     * ```ts
     * actions.camera.setView({ w: 960, h: 720 });
     * ```
     */
    setView(view) {
      camera.viewport = { w: view.w, h: view.h };
      if (!camera.initialised && env.active()) actions.applyDefault();
      else applyCamera(ctx);
    },

    /**
     * The insets of the available rect.
     *
     * @returns The insets.
     * @example
     * ```ts
     * actions.camera.insets().bottom; // 224 while the strip is open
     * ```
     */
    insets() {
      return insetsOf(ctx, env);
    },

    /**
     * Cancels the running tween.
     *
     * @example
     * ```ts
     * actions.camera.cancel();
     * ```
     */
    cancel() {
      cancelAnimation(ctx);
    },

    /**
     * Writes the camera to the DOM.
     *
     * @example
     * ```ts
     * actions.camera.apply();
     * ```
     */
    apply() {
      applyCamera(ctx);
    },

    /**
     * Runs a camera op of input.ts.
     *
     * @param op - The op.
     * @example
     * ```ts
     * actions.camera.run({ kind: "pan", dx: 0, dy: -48 });
     * ```
     */
    run(op: CameraOp) {
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
