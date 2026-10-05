/**
 * @file gameView plugin — selection and the picker (F11): pick on/off, select (every change
 * publishes the selection, U4), inspect, the pink highlight box, hover and click through the
 * frame box (`pageFromClient`, `elementAt` of the shared scene, R8), the click on a Reference mode
 * proxy (both complete the pick, round 2 R2), and the two cross-view intents of the Element tab
 * (`workspace:reveal`, `workspace:open-file`, R4).
 */
import type { ElementRef, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { elementAt, pageFromClient, refId } from "../../panels/shared/scene";
import { workspacePlugin } from "../../workspace";
import type { FrameBox } from "../../workspace/types";
import { hideCard } from "../capture/shot";
import { completePick } from "../reference/pick";
import { logReadFailure, messageOf } from "../report";
import { readFreshScene, readScene } from "../scene/read";
import { notify } from "../state";
import type { ClientPoint, GameViewCtx } from "../types";
import { ensureOverlayRoot } from "../ui/OverlayRoot";
import { publishSelected } from "./publish";
import { saveStyle } from "./styles";

/**
 * Turns the picker on (shows Game and the Element tab, hides the capture card so the first Esc
 * leaves the picker, round 2b R17) or off (clears the hover); toggles without an argument.
 *
 * @param ctx - Domain context of gameView.
 * @param on - The wanted state; omitted toggles.
 */
export function setPicker(ctx: GameViewCtx, on?: boolean): void {
  const { state } = ctx;
  const next = on ?? !state.picker.on;
  if (next) {
    ctx.require(workspacePlugin).show("game");
    state.tab = "element";
    ensureOverlayRoot(ctx);
    hideCard(ctx);
  }
  state.picker = { on: next, hover: undefined };
  notify(state);
}

/**
 * The selected element.
 *
 * @param ctx - Domain context of gameView.
 * @returns The ref, undefined when nothing is selected.
 */
export function selectedElement(ctx: Pick<GameViewCtx, "state">): ElementRef | undefined {
  return ctx.state.selected;
}

/**
 * Sets the selected element (or none) without publishing it, and clears the style card; a pending
 * style edit is saved first. An area pick publishes its own selection after it (U9).
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element; omitted to clear.
 */
export function applySelection(ctx: GameViewCtx, ref?: ElementRef): void {
  const { state } = ctx;
  if (state.styles?.pending !== undefined) void saveStyle(ctx);
  state.selected = ref;
  state.styles = undefined;
  state.lookup = undefined;
  notify(state);
}

/**
 * Selects an element (or none), clears the style card and publishes the selection to the hub
 * (`link.notify("selection")`, U4); a pending style edit is saved first.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element, undefined to clear.
 */
export function selectElement(ctx: GameViewCtx, ref: ElementRef | undefined): void {
  applySelection(ctx, ref);
  publishSelected(ctx);
}

/**
 * Selects an element, opens the Element tab and shows Game (the workspace:inspect hook, R9).
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element.
 */
export function inspectElement(ctx: GameViewCtx, ref: ElementRef): void {
  selectElement(ctx, ref);
  ctx.state.tab = "element";
  ctx.require(workspacePlugin).show("game");
  notify(ctx.state);
}

/**
 * Draws the pink box around an element (undefined clears it). Without a built scene it reads
 * one first; a newer call drops this one.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element; omitted to clear.
 */
export function highlightElement(ctx: GameViewCtx, ref?: ElementRef): void {
  const { state } = ctx;
  state.highlightSeq += 1;
  const request = state.highlightSeq;
  if (ref === undefined || state.scene?.nodes.has(refId(ref))) {
    state.treeHover = ref;
    if (ref !== undefined) ensureOverlayRoot(ctx);
    notify(state);
    return;
  }

  readScene(ctx).then(
    () => {
      if (request !== state.highlightSeq) return;
      state.treeHover = ref;
      ensureOverlayRoot(ctx);
      notify(state);
    },
    (error: unknown) => {
      if (request === state.highlightSeq) {
        logReadFailure(ctx, "gameView: highlight failed", error);
      }
    }
  );
}

/**
 * The scene node under a client point: through the frame box to page px, then the shared
 * elementAt. Nothing without a calibrated scene or a frame box.
 *
 * @param scene - The scene, undefined before the first build.
 * @param box - The frame box, undefined while the frame is not mounted.
 * @param client - The pointer in client px.
 * @returns The node, or undefined.
 */
function nodeIn(
  scene: SceneSnapshot | undefined,
  box: FrameBox | undefined,
  client: ClientPoint
): SceneNode | undefined {
  if (scene === undefined || !scene.calibrated || box === undefined || box.scale <= 0) {
    return undefined;
  }
  return elementAt(scene, pageFromClient(client, box));
}

/**
 * The frame box now.
 *
 * @param ctx - Domain context of gameView.
 * @returns The box, undefined while the frame is not mounted.
 */
function frameBox(ctx: GameViewCtx): FrameBox | undefined {
  return ctx.require(workspacePlugin).gameFrame().box();
}

/**
 * Picker hover: the node under the pointer becomes the hover box (undefined clears it).
 *
 * @param ctx - Domain context of gameView.
 * @param client - The pointer in client px; omitted when it left the layer.
 */
export function hoverAt(ctx: GameViewCtx, client?: ClientPoint): void {
  const hover =
    client === undefined ? undefined : nodeIn(ctx.state.scene, frameBox(ctx), client)?.id;
  if (ctx.state.picker.hover === hover) return;
  ctx.state.picker.hover = hover;
  notify(ctx.state);
}

/**
 * Picker click: reads the scene once more and selects the node under the pointer in it, turns
 * the picker off and opens the Element tab, then completes the pick (bookmark, shot, the
 * reference block on the clipboard). The watched scene can be a heartbeat behind a screen change
 * (R6), and a calibration may be in flight, so the click waits for both. A click on nothing keeps
 * the picker on. A failed read picks from the scene there is. When the picker went off meanwhile
 * (Esc, or an earlier click picked), the click does nothing.
 *
 * @param ctx - Domain context of gameView.
 * @param client - The pointer in client px.
 * @returns Resolves when the click is handled and the pick completed (never rejects).
 */
export async function pickAt(ctx: GameViewCtx, client: ClientPoint): Promise<void> {
  const { state } = ctx;
  const box = frameBox(ctx);
  try {
    await readFreshScene(ctx);
  } catch (error) {
    ctx.log.debug("gameView: pick read failed", { message: messageOf(error) });
  }
  if (!state.picker.on) return;

  const { scene } = state;
  const node = nodeIn(scene, box, client);
  if (scene === undefined || node === undefined) return;
  selectElement(ctx, node.ref);
  state.picker = { on: false, hover: undefined };
  state.tab = "element";
  notify(state);
  await completePick(ctx, node, scene);
}

/**
 * A click on a Reference mode proxy: selects its node and completes the pick, like a picker
 * click, in whatever workspace shows.
 *
 * @param ctx - Domain context of gameView.
 * @param id - The node id of the proxy.
 * @returns Resolves when the pick completed (never rejects); nothing for a node not in the scene.
 */
export async function pickProxy(ctx: GameViewCtx, id: string): Promise<void> {
  const { scene } = ctx.state;
  const node = scene?.nodes.get(id);
  if (scene === undefined || node === undefined) return;
  selectElement(ctx, node.ref);
  await completePick(ctx, node, scene);
}

/**
 * "Show in render tree": renderView selects the row and shows Render (R4).
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element.
 */
export function revealElement(ctx: GameViewCtx, ref: ElementRef): void {
  ctx.emit("workspace:reveal", { ref });
}

/**
 * "Open in Files": filesView shows the file, at the line when one is given (R4).
 *
 * @param ctx - Domain context of gameView.
 * @param path - The file.
 * @param line - The 1-based line; omitted for a picture.
 */
export function openInFiles(ctx: GameViewCtx, path: string, line?: number): void {
  ctx.emit("workspace:open-file", line === undefined ? { path } : { path, line });
}
