/**
 * @file flowView camera module — types: camera state, view size and insets, camera ops and
 * intents, the camera api.
 */
import type { Camera, ItemKey } from "../types";

/**
 * Viewport size in px.
 */
export type ViewSize = { w: number; h: number };

/**
 * Insets of the available rect in px.
 */
export type ViewInsets = { top: number; right: number; bottom: number; left: number };

/**
 * Camera module state.
 */
export type CameraState = {
  cam: Camera;
  /** rAF id of the running tween. */
  anim: number | undefined;
  /** Follow the game (M9: only the toggle changes it). */
  follow: boolean;
  viewport: ViewSize;
  insets: ViewInsets;
  /** The default camera was applied once for the current root. */
  initialised: boolean;
};

/**
 * A camera operation produced by input.ts.
 */
export type CameraOp =
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number }
  | { readonly kind: "zoom"; readonly px: number; readonly py: number; readonly factor: number }
  | { readonly kind: "zoomTo"; readonly z: number }
  | { readonly kind: "fit"; readonly target: "all" | "selection" };

/**
 * A non-camera intent produced by input.ts.
 */
export type CameraIntent =
  | { readonly kind: "clear" }
  | { readonly kind: "select"; readonly key: ItemKey }
  | { readonly kind: "enter"; readonly key: ItemKey };

/**
 * The camera namespace of the api.
 */
export type CameraApi = {
  /** Current camera. */
  get(): Camera;
  /** Fit every item of the root frame (F / ⇧1). */
  fitAll(): void;
  /** Fit the selection and its neighbours (⇧2). */
  fitSelection(): void;
  /** Zoom by a factor around the viewport centre, 200 ms. */
  zoomBy(factor: number): void;
  /** Set an absolute zoom around the viewport centre. */
  zoomTo(z: number): void;
  /** Toggle or set Follow the game. Returns the new value. */
  follow(on?: boolean): boolean;
};
