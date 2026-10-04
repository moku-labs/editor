/**
 * @file workspace plugin — the single game frame (R4, D-14). The first mount creates one fixed
 * layer in `document.body` holding the frame box with the iframe and the overlay element; it is
 * never re-parented, because moving an iframe reloads its document. Docking is geometry only:
 * `syncFrame` reads the target rects once and writes one transform and one clip; the clip rounds
 * the screen corners by the preset radius. The docked iframe takes the pointer and the keyboard
 * in the preview and on the Game stage; Reference mode marks the box so its overlay takes the
 * pointer instead.
 */
import { linkPlugin } from "../../link";
import { resolveDevice } from "../../registry/protocol";
import { deviceChoiceOf } from "../devices";
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
import { centreBox, clipInsets, clipPathOf, fitScale } from "./dock";
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
 * The `src` of the game frame: the game URL tagged with the frame id of this tools page
 * (`link.frameUrl`), so link and the reload know the frame's session from another tab's.
 *
 * @param ctx - Domain context of workspace.
 * @returns The tagged URL.
 */
export function taggedGameUrl(ctx: Pick<WorkspaceCtx, "require">): string {
  return ctx.require(linkPlugin).frameUrl(gameUrl(ctx));
}

/**
 * The overlay element above the iframe (device space), created once; attached into the frame box
 * by the first mount.
 *
 * @param state - Workspace state.
 * @returns The element.
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
 */
export function createFrameLayer(ctx: Pick<WorkspaceCtx, "state" | "require">): void {
  const { state } = ctx;
  if (state.frame.layer !== undefined) return;

  // The fixed layer and the box that docking moves; hidden until the first dock.
  const layer = document.createElement("div");
  layer.dataset.frameLayer = "";
  const box = document.createElement("div");
  box.dataset.frameBox = "";
  box.dataset.docked = "hidden";
  markReference(box, state.reference);

  // The game page, tagged with this tab's frame id; out of the tab order until it is docked.
  const iframe = document.createElement("iframe");
  iframe.dataset.gameFrame = "";
  iframe.title = "Game";
  iframe.setAttribute("allow", "autoplay; fullscreen");
  iframe.tabIndex = -1;
  iframe.src = taggedGameUrl(ctx);

  // Attach once in document.body: an iframe that moves reloads its document.
  box.append(iframe, ensureOverlay(state));
  layer.append(box);
  document.body.append(layer);
  state.frame.layer = layer;
  state.frame.iframe = iframe;
}

/**
 * Marks the frame box while Reference mode is on (`[data-reference]` in Frame.css gives the
 * overlay the pointer and outlines the frame).
 *
 * @param element - The frame box.
 * @param on - Whether Reference mode is on.
 */
function markReference(element: HTMLElement, on: boolean): void {
  if (on) element.dataset.reference = "";
  else delete element.dataset.reference;
}

/**
 * Removes the frame layer and forgets the frame (onStop).
 *
 * @param state - Workspace state.
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
 * The size and the corner radius of the screen in use: the preset, its orientation and, for a
 * foldable, the cover or the inner screen.
 *
 * @param state - Workspace state.
 * @returns Size in game CSS px and the corner radius.
 */
function screenSize(state: WorkspaceState): DeviceSize & { readonly radius: number } {
  const { preset, orientation } = deviceChoiceOf(state.device);
  return { ...resolveDevice(preset, orientation), radius: preset.radius };
}

/**
 * Where the frame docks (design table): the stage slot in Game, the preview body elsewhere while
 * the preview of the workspace is visible, else nowhere (hidden).
 *
 * @param state - Workspace state.
 * @returns The target, undefined when hidden.
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
 * The frame box over a dock target: the device scaled to fit the target rect, centred in it.
 *
 * @param target - The dock target.
 * @param size - The device size in game CSS px.
 * @returns The box in tools-page px.
 */
function frameBoxOf(target: DockTarget, size: DeviceSize): FrameBox {
  const slot = { w: target.rect.width, h: target.rect.height };
  const scale = fitScale(slot, size, target.fit, target.cap);
  const { left, top } = centreBox(target.rect, size, scale);
  return {
    left,
    top,
    width: size.w * scale,
    height: size.h * scale,
    scale,
    docked: target.docked
  };
}

/**
 * Hides the frame: no dock target is shown, so the iframe leaves the tab order.
 *
 * @param state - Workspace state.
 * @param element - The frame element (the iframe's parent).
 * @param iframe - The game iframe.
 */
function hideFrame(state: WorkspaceState, element: HTMLElement, iframe: HTMLIFrameElement): void {
  state.frame.box = { ...HIDDEN_BOX };
  element.style.visibility = "hidden";
  element.dataset.docked = "hidden";
  iframe.tabIndex = -1;
}

/**
 * Positions the frame over its target: one rect read per element, one transform and one clip
 * written. Before the first mount it does nothing.
 *
 * @param ctx - Domain context of workspace.
 */
export function syncFrame(ctx: Pick<WorkspaceCtx, "state">): void {
  const { state } = ctx;
  const iframe = state.frame.iframe;
  const element = iframe?.parentElement;
  if (iframe === undefined || element === null || element === undefined) return;

  // The frame element keeps the device size; only its transform scales it.
  const size = screenSize(state);
  element.style.width = `${size.w}px`;
  element.style.height = `${size.h}px`;
  markReference(element, state.reference);

  const target = dockTarget(state);
  if (target === undefined) {
    hideFrame(state, element, iframe);
    return;
  }

  // Place and clip it over the target with the screen's round corners; the docked game takes
  // the pointer and the keyboard.
  const box = frameBoxOf(target, size);
  const clip = clipInsets(box, target.clip.getBoundingClientRect());
  state.frame.box = box;
  element.style.transform = `translate(${box.left}px, ${box.top}px) scale(${box.scale})`;
  element.style.clipPath = clipPathOf(clip, size.radius);
  element.style.setProperty("--frame-scale", String(box.scale));
  element.style.visibility = "visible";
  element.dataset.docked = target.docked;
  iframe.tabIndex = 0;
}

/**
 * Observes elements for size changes, where `ResizeObserver` exists.
 *
 * @param elements - The elements (undefined entries are skipped).
 * @param onResize - Called after a size change.
 * @returns The observer, undefined without `ResizeObserver`.
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
 */
export function followTransitions(
  ctx: Pick<WorkspaceCtx, "state">,
  element: HTMLElement
): () => void {
  let running = false;
  let frameId: number | undefined;

  /**
   * One loop step: sync, then schedule the next step while the transition runs.
   */
  const tick = (): void => {
    syncFrame(ctx);
    frameId = running ? requestAnimationFrame(tick) : undefined;
  };

  /**
   * Starts the loop once per transition.
   */
  const start = (): void => {
    if (running) return;
    running = true;
    frameId = requestAnimationFrame(tick);
  };

  /**
   * Lets the loop end after its next step.
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
 * The GameFrame api object (`workspace.gameFrame()`). The contract of each member is on
 * `GameFrame` in `types.ts`.
 *
 * @param ctx - Domain context of workspace.
 * @returns The frame api.
 */
export function createGameFrame(ctx: WorkspaceCtx): GameFrame {
  return {
    /**
     * The getter of `GameFrame.url`; the contract is on the type.
     *
     * @returns The absolute URL of the game page.
     */
    get url() {
      return gameUrl(ctx);
    },

    reload: opts => reloadFrame(ctx, { ...opts, afterSave: true }),

    dock: (slot, opts) => dockFrame(ctx, slot, opts),

    overlay: () => ensureOverlay(ctx.state),

    box: () => {
      const { box } = ctx.state.frame;
      return box === undefined ? undefined : { ...box };
    }
  };
}
