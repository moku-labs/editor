/**
 * @file flowView camera module — camera moves: an rAF tween (ease-out cubic, log-scale zoom,
 * linear world centre), cancel on a new move, a jump under reduced motion, and the direct DOM
 * write of the camera (world transform and dot grid) that bypasses Preact.
 */
import { notifyCamera } from "../state";
import type { Camera, FlowViewState } from "../types";
import { gridStep, logLerp } from "./math";
import type { ViewSize } from "./types";

/**
 * Move durations in ms: camera moves, zoom buttons, Follow (design §2 motion).
 */
export const DURATION = { camera: 420, zoom: 200, follow: 500 } as const;

/**
 * The part of the context the camera moves use.
 */
type CameraHost = { readonly state: FlowViewState };

/**
 * Ease-out cubic.
 *
 * @param t - Progress 0…1.
 * @returns Eased progress.
 * @example
 * ```ts
 * easeOutCubic(0.5); // 0.875
 * ```
 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * True when the user asked for reduced motion (read at each move).
 *
 * @returns Whether moves jump.
 * @example
 * ```ts
 * if (prefersReducedMotion()) jump();
 * ```
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The camera at progress t between two cameras: zoom in log scale, the world point at the
 * viewport centre linearly.
 *
 * @param from - Start camera.
 * @param to - End camera.
 * @param t - Eased progress 0…1.
 * @param view - The viewport size.
 * @returns The camera at t.
 * @example
 * ```ts
 * tween({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 4 }, 0.5, { w: 0, h: 0 }).z; // 2
 * ```
 */
export function tween(from: Camera, to: Camera, t: number, view: ViewSize): Camera {
  const cx = view.w / 2;
  const cy = view.h / 2;
  const startX = (cx - from.x) / from.z;
  const startY = (cy - from.y) / from.z;
  const endX = (cx - to.x) / to.z;
  const endY = (cy - to.y) / to.z;
  const z = logLerp(from.z, to.z, t);
  return {
    x: cx - (startX + (endX - startX) * t) * z,
    y: cy - (startY + (endY - startY) * t) * z,
    z
  };
}

/**
 * Writes the camera to the DOM in one go — `transform` on the world layer, the dot grid size and
 * offset on the canvas — then notifies the camera subscribers only.
 *
 * @param ctx - Anything with the flowView state.
 * @example
 * ```ts
 * ctx.state.camera.cam = next;
 * applyCamera(ctx);
 * ```
 */
export function applyCamera(ctx: CameraHost): void {
  const { cam } = ctx.state.camera;
  const root = ctx.state.view.root;
  const world = root?.querySelector<HTMLElement>('[data-flow="world"]');
  if (world !== undefined && world !== null) {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  }
  const canvas = root?.querySelector<HTMLElement>('[data-flow="canvas"]');
  if (canvas !== undefined && canvas !== null) {
    const step = gridStep(cam.z);
    canvas.style.backgroundSize = `${step}px ${step}px`;
    canvas.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  }
  notifyCamera(ctx.state);
}

/**
 * Cancels the running tween.
 *
 * @param ctx - Anything with the flowView state.
 * @example
 * ```ts
 * cancelAnimation(ctx); // before a pan
 * ```
 */
export function cancelAnimation(ctx: CameraHost): void {
  const { camera } = ctx.state;
  if (camera.anim !== undefined && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(camera.anim);
  }
  camera.anim = undefined;
}

/**
 * Animates the camera to a target over a duration (ease-out cubic); a new move cancels the
 * running one; reduced motion or a zero duration jumps.
 *
 * @param ctx - Anything with the flowView state.
 * @param target - The target camera.
 * @param durationMs - The duration.
 * @example
 * ```ts
 * animateTo(ctx, focusCamera(item, cam, view, insets), DURATION.camera);
 * ```
 */
export function animateTo(ctx: CameraHost, target: Camera, durationMs: number): void {
  cancelAnimation(ctx);
  const { camera } = ctx.state;
  if (durationMs <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
    camera.cam = { ...target };
    applyCamera(ctx);
    return;
  }

  const from = { ...camera.cam };
  let start: number | undefined;

  /**
   * One frame of the tween.
   *
   * @param time - The rAF timestamp.
   * @example
   * ```ts
   * requestAnimationFrame(step);
   * ```
   */
  function step(time: number): void {
    start ??= time;
    const t = Math.min(1, (time - start) / durationMs);
    camera.cam = t >= 1 ? { ...target } : tween(from, target, easeOutCubic(t), camera.viewport);
    applyCamera(ctx);
    camera.anim = t >= 1 ? undefined : requestAnimationFrame(step);
  }

  camera.anim = requestAnimationFrame(step);
}
