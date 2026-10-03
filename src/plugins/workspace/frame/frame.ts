/**
 * @file workspace plugin — the single game frame (R4, D-14). The first mount creates one fixed
 * layer in `document.body` holding the frame box with the iframe and the overlay element; it is
 * never re-parented, because moving an iframe reloads its document. Docking is geometry only:
 * `syncFrame` reads the target rects once and writes one transform and one clip.
 */
import { linkPlugin } from "../../link";
import { presetOf, resolveDevice } from "../devices";
import { hostOf } from "../hosts";
import { trackCleanup } from "../state";
import type {
  DeviceSize,
  FrameBox,
  FrameFit,
  GameFrame,
  RectBox,
  StageDock,
  WorkspaceCtx,
  WorkspaceState
} from "../types";
import { centreBox, clipInsets, fitScale } from "./dock";
import { reloadFrame } from "./reload";

/**
 * The frame box while nothing shows it.
 */
const HIDDEN_BOX: FrameBox = { left: 0, top: 0, width: 0, height: 0, scale: 0, docked: "hidden" };

/**
 * Where the frame goes now.
 */
type DockTarget = {
  readonly rect: RectBox;
  readonly fit: FrameFit;
  readonly cap: boolean;
  readonly clip: Element;
  readonly docked: "preview" | "stage";
};

/**
 * Absolute URL of the game page: `link.boot()?.gameUrl` (R1 `ToolsBoot`), else "/", resolved
 * against the tools page URL.
 *
 * @param ctx - Domain context of workspace.
 * @returns The URL.
 * @example
 * ```ts
 * iframe.src = gameUrl(ctx);
 * ```
 */
export function gameUrl(ctx: Pick<WorkspaceCtx, "require">): string {
  const path = ctx.require(linkPlugin).boot()?.gameUrl ?? "/";
  try {
    return new URL(path, globalThis.location?.href).href;
  } catch {
    return path;
  }
}

/**
 * The overlay element above the iframe (device space), created once; attached into the frame box
 * by the first mount.
 *
 * @param state - Workspace state.
 * @returns The element.
 * @example
 * ```ts
 * ensureOverlay(ctx.state).append(pickerBox);
 * ```
 */
export function ensureOverlay(state: WorkspaceState): HTMLElement {
  if (state.frame.overlay !== undefined) return state.frame.overlay;

  const overlay = document.createElement("div");
  overlay.dataset.frameOverlay = "";
  state.frame.overlay = overlay;
  return overlay;
}

/**
 * Creates the frame layer, the frame box, the iframe and attaches the overlay, once, in
 * `document.body` (not in the shell root, so a later mount into another element cannot move it).
 *
 * @param ctx - Domain context of workspace.
 * @example
 * ```ts
 * createFrameLayer(ctx); // first mount only; later calls do nothing
 * ```
 */
export function createFrameLayer(ctx: Pick<WorkspaceCtx, "state" | "require">): void {
  const { state } = ctx;
  if (state.frame.layer !== undefined) return;

  const layer = document.createElement("div");
  layer.dataset.frameLayer = "";
  const box = document.createElement("div");
  box.dataset.frameBox = "";
  box.dataset.docked = "hidden";
  const iframe = document.createElement("iframe");
  iframe.dataset.gameFrame = "";
  iframe.title = "Game";
  iframe.setAttribute("allow", "autoplay; fullscreen");
  iframe.tabIndex = -1;
  iframe.src = gameUrl(ctx);

  box.append(iframe, ensureOverlay(state));
  layer.append(box);
  document.body.append(layer);
  state.frame.layer = layer;
  state.frame.iframe = iframe;
}

/**
 * Removes the frame layer and forgets the frame (onStop).
 *
 * @param state - Workspace state.
 * @example
 * ```ts
 * removeFrameLayer(ctx.state);
 * ```
 */
export function removeFrameLayer(state: WorkspaceState): void {
  state.frame.layer?.remove();
  state.frame.layer = undefined;
  state.frame.iframe = undefined;
  state.frame.overlay = undefined;
  state.frame.box = undefined;
  state.frame.stage = undefined;
}

/**
 * The device size of the current preset and orientation.
 *
 * @param state - Workspace state.
 * @returns Size in game CSS px.
 * @example
 * ```ts
 * deviceSize(ctx.state).w; // 393
 * ```
 */
function deviceSize(state: WorkspaceState): DeviceSize {
  return resolveDevice(presetOf(state.device.preset), state.device.orientation);
}

/**
 * Where the frame docks (design table): the stage slot in Game, the preview body elsewhere while
 * the preview of the workspace is visible, else nowhere (hidden).
 *
 * @param state - Workspace state.
 * @returns The target, undefined when hidden.
 * @example
 * ```ts
 * dockTarget(ctx.state)?.docked; // "preview"
 * ```
 */
function dockTarget(state: WorkspaceState): DockTarget | undefined {
  const { active, frame } = state;
  if (active === "game") {
    const stage: StageDock | undefined = frame.stage;
    if (stage === undefined) return undefined;
    return {
      rect: stage.slot.getBoundingClientRect(),
      fit: stage.fit,
      cap: true,
      clip: stage.clip ?? hostOf(state, "game"),
      docked: "stage"
    };
  }

  const body = frame.previewBody;
  if (body === undefined || !state.previews[active].visible) return undefined;
  return {
    rect: body.getBoundingClientRect(),
    fit: "fit",
    cap: false,
    clip: body,
    docked: "preview"
  };
}

/**
 * Positions the frame over its target: one rect read per element, one transform and one clip
 * written. Before the first mount it does nothing.
 *
 * @param ctx - Domain context of workspace.
 * @example
 * ```ts
 * globalThis.addEventListener("resize", () => syncFrame(ctx));
 * ```
 */
export function syncFrame(ctx: Pick<WorkspaceCtx, "state">): void {
  const { state } = ctx;
  const iframe = state.frame.iframe;
  const element = iframe?.parentElement;
  if (iframe === undefined || element === null || element === undefined) return;

  const size = deviceSize(state);
  element.style.width = `${size.w}px`;
  element.style.height = `${size.h}px`;

  const target = dockTarget(state);
  if (target === undefined) {
    state.frame.box = { ...HIDDEN_BOX };
    element.style.visibility = "hidden";
    element.dataset.docked = "hidden";
    iframe.tabIndex = -1;
    return;
  }

  const scale = fitScale(
    { w: target.rect.width, h: target.rect.height },
    size,
    target.fit,
    target.cap
  );
  const { left, top } = centreBox(target.rect, size, scale);
  const box: FrameBox = {
    left,
    top,
    width: size.w * scale,
    height: size.h * scale,
    scale,
    docked: target.docked
  };
  const clip = clipInsets(box, target.clip.getBoundingClientRect());

  state.frame.box = box;
  element.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  element.style.clipPath = `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)`;
  element.style.visibility = "visible";
  element.dataset.docked = target.docked;
  iframe.tabIndex = target.docked === "stage" ? 0 : -1;
}

/**
 * Observes elements for size changes, where `ResizeObserver` exists.
 *
 * @param elements - The elements (undefined entries are skipped).
 * @param onResize - Called after a size change.
 * @returns The observer, undefined without `ResizeObserver`.
 * @example
 * ```ts
 * const observer = observeResize([slot, clip], () => syncFrame(ctx));
 * ```
 */
function observeResize(
  elements: readonly (Element | undefined)[],
  onResize: () => void
): ResizeObserver | undefined {
  if (globalThis.ResizeObserver === undefined) return undefined;

  const observer = new ResizeObserver(() => {
    onResize();
  });
  for (const element of elements) if (element !== undefined) observer.observe(element);
  return observer;
}

/**
 * Docks the frame over a stage slot (gameView, while Game is active): geometry only, the iframe
 * never moves. A newer dock replaces an older one.
 *
 * @param ctx - Domain context of workspace.
 * @param slot - The stage slot.
 * @param opts - How the device fits and what clips it.
 * @param opts.fit - fit (capped at 1) or actual (1).
 * @param opts.clip - Clip element; default the Game workspace host.
 * @returns Releases the dock (once).
 * @example
 * ```ts
 * const release = dockFrame(ctx, stageEl, { fit: "fit" });
 * ```
 */
export function dockFrame(
  ctx: Pick<WorkspaceCtx, "state">,
  slot: HTMLElement,
  opts: { readonly fit: FrameFit; readonly clip?: HTMLElement }
): () => void {
  const { state } = ctx;
  const stage: StageDock = { slot, fit: opts.fit, clip: opts.clip };
  state.frame.stage = stage;

  const observer = observeResize([slot, opts.clip], () => {
    syncFrame(ctx);
  });
  const untrack = trackCleanup(state, () => observer?.disconnect());
  syncFrame(ctx);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    observer?.disconnect();
    untrack();
    if (state.frame.stage === stage) state.frame.stage = undefined;
    syncFrame(ctx);
  };
}

/**
 * Follows a CSS transition of the preview: a rAF loop of `syncFrame` from `transitionrun` to
 * `transitionend` (or `transitioncancel`), so the frame moves with the resizing float.
 *
 * @param ctx - Domain context of workspace.
 * @param element - The element whose transitions move the frame target.
 * @returns Removes the listeners and stops the loop.
 * @example
 * ```ts
 * useLayoutEffect(() => followTransitions(ctx, previewRef.current!), []);
 * ```
 */
export function followTransitions(
  ctx: Pick<WorkspaceCtx, "state">,
  element: HTMLElement
): () => void {
  let running = false;
  let frameId: number | undefined;

  /**
   * One loop step: sync, then schedule the next step while the transition runs.
   *
   * @example
   * ```ts
   * requestAnimationFrame(tick);
   * ```
   */
  const tick = (): void => {
    syncFrame(ctx);
    frameId = running ? requestAnimationFrame(tick) : undefined;
  };

  /**
   * Starts the loop once per transition.
   *
   * @example
   * ```ts
   * element.addEventListener("transitionrun", start);
   * ```
   */
  const start = (): void => {
    if (running) return;
    running = true;
    frameId = requestAnimationFrame(tick);
  };

  /**
   * Lets the loop end after its next step.
   *
   * @example
   * ```ts
   * element.addEventListener("transitionend", stop);
   * ```
   */
  const stop = (): void => {
    running = false;
  };

  element.addEventListener("transitionrun", start);
  element.addEventListener("transitionend", stop);
  element.addEventListener("transitioncancel", stop);
  return () => {
    stop();
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    element.removeEventListener("transitionrun", start);
    element.removeEventListener("transitionend", stop);
    element.removeEventListener("transitioncancel", stop);
  };
}

/**
 * The GameFrame api object (`workspace.gameFrame()`).
 *
 * @param ctx - Domain context of workspace.
 * @returns The frame api.
 * @example
 * ```ts
 * await createGameFrame(ctx).reload({ restore: true });
 * ```
 */
export function createGameFrame(ctx: WorkspaceCtx): GameFrame {
  return {
    /**
     * Absolute URL of the game page.
     *
     * @returns `link.boot()?.gameUrl` resolved, "/" without a boot.
     * @example
     * ```ts
     * workspace.gameFrame().url; // "http://127.0.0.1:3000/"
     * ```
     */
    get url() {
      return gameUrl(ctx);
    },

    /**
     * The D-07 reload: bookmark → reload in place → restore on the new session → toast.
     *
     * @param opts - `restore: true` bookmarks first and restores after.
     * @returns The result; concurrent calls share one run.
     * @example
     * ```ts
     * await workspace.gameFrame().reload({ restore: true });
     * ```
     */
    reload(opts) {
      return reloadFrame(ctx, opts ?? {});
    },

    /**
     * Docks the frame over a stage slot; geometry only.
     *
     * @param slot - The stage slot.
     * @param opts - fit and optional clip element.
     * @returns The release function.
     * @example
     * ```ts
     * const release = workspace.gameFrame().dock(stageEl, { fit: "fit" });
     * ```
     */
    dock(slot, opts) {
      return dockFrame(ctx, slot, opts);
    },

    /**
     * The element above the iframe in device space (game CSS px, scaled with the frame).
     *
     * @returns The overlay element; pointer-events none by default.
     * @example
     * ```ts
     * workspace.gameFrame().overlay().append(highlightBox);
     * ```
     */
    overlay() {
      return ensureOverlay(ctx.state);
    },

    /**
     * The current frame box in tools-page px.
     *
     * @returns A copy, undefined before the first mount.
     * @example
     * ```ts
     * workspace.gameFrame().box()?.scale; // 0.5
     * ```
     */
    box() {
      const { box } = ctx.state.frame;
      return box === undefined ? undefined : { ...box };
    }
  };
}
