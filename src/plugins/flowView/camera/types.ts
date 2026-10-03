/**
 * @file flowView camera module — types: camera state, view size and insets, camera ops and
 * intents, the public camera api and the internal camera actions.
 */
import type { Camera, Item, ItemKey } from "../types";

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
  | { readonly kind: "zoomBy"; readonly factor: number }
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
 * What a pointer went down on (input.ts hit rules, M2).
 */
export type HitTarget = "canvas" | "frame" | "lane" | "hub-head" | "card" | "note";

/**
 * The camera namespace of the api (`app.flowView.camera`).
 */
export type CameraApi = {
  /**
   * The current camera: screen = world · z + (x, y). A copy.
   *
   * @returns The camera.
   * @example
   * ```ts
   * // The zoom readout of the zoom bar.
   * Math.round(app.flowView.camera.get().z * 100); // 100
   * ```
   */
  get(): Camera;

  /**
   * Fits every item of the root frame (F / ⇧1), leaving room for the preview and the minimap.
   *
   * @example
   * ```ts
   * // After a long walk through the board, show the whole main frame again.
   * app.flowView.camera.fitAll(); // whole main frame in view
   * ```
   */
  fitAll(): void;

  /**
   * Fits the selection and its neighbours (⇧2); the current node when nothing is selected.
   *
   * @example
   * ```ts
   * app.flowView.focus.select("board/merge");
   * app.flowView.camera.fitSelection(); // merge, awaitIntent and the stubs of merge in view
   * ```
   */
  fitSelection(): void;

  /**
   * Zooms by a factor around the viewport centre (+ / −: 1.25 / 0.8), animated over 200 ms.
   *
   * @param factor - The zoom factor; the result is clamped to 8 %–300 %.
   * @example
   * ```ts
   * app.flowView.camera.zoomBy(1.25); // 100 % → 125 %
   * ```
   */
  zoomBy(factor: number): void;

  /**
   * Sets an absolute zoom around the viewport centre (key 0 → 1), animated over 200 ms.
   *
   * @param z - The zoom; clamped to 8 %–300 %.
   * @example
   * ```ts
   * app.flowView.camera.zoomTo(1); // 100 %
   * ```
   */
  zoomTo(z: number): void;

  /**
   * Toggles or sets Follow the game (B5). Only this call and the toolbar toggle change it (M9).
   *
   * @param on - The new value; omitted = toggle.
   * @returns The new value.
   * @example
   * ```ts
   * app.flowView.camera.follow(true); // true: the camera tracks game.position
   * ```
   */
  follow(on?: boolean): boolean;
};

/**
 * The camera actions: the api plus what the components and the other modules call.
 */
export type CameraActions = CameraApi & {
  /** Pans by screen px at once (wheel, drag). */
  panBy(dx: number, dy: number): void;
  /** Zooms by a factor around a screen point at once (Ctrl/⌘ + wheel, pinch). */
  zoomAround(px: number, py: number, factor: number): void;
  /** Moves the viewport centre onto a world point, animated (minimap click) or live (drag). */
  centreOn(x: number, y: number, animate: boolean): void;
  /** Focus move onto an item (focusCamera, 420 ms). */
  focusItem(item: Item): void;
  /** Follow move onto an item (followCamera, 500 ms). */
  followItem(item: Item): void;
  /** Applies the default camera once per root (M11). */
  applyDefault(): void;
  /** Records the canvas size; applies the default camera when it was not yet applied. */
  setView(view: ViewSize): void;
  /** The insets of the available rect: strip, preview column (also stored in state). */
  insets(): ViewInsets;
  /** Cancels the running tween. */
  cancel(): void;
  /** Writes the camera to the DOM and notifies the camera subscribers. */
  apply(): void;
  /** Runs a camera op from input.ts. */
  run(op: CameraOp): void;
};
