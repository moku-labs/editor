/**
 * @file gameView plugin — selection and the picker (F11): pick on/off, select, inspect, the pink
 * highlight box, hover and click through the frame box (`pageFromClient`, `elementAt` of the
 * shared scene, R8), and the two cross-view intents of the Element tab (`workspace:reveal`,
 * `workspace:open-file`, R4).
 */
import type { ElementRef, SceneNode } from "../../panels/shared/scene";
import { elementAt, pageFromClient, refId } from "../../panels/shared/scene";
import { workspacePlugin } from "../../workspace";
import { messageOf } from "../report";
import { readScene } from "../scene/read";
import { notify } from "../state";
import type { GameViewCtx } from "../types";
import { ensureOverlayRoot } from "../ui/OverlayRoot";
import { saveStyle } from "./styles";

/**
 * A point in client px.
 */
export type ClientPoint = { readonly x: number; readonly y: number };

/**
 * Turns the picker on (shows Game and the Element tab) or off (clears the hover); toggles
 * without an argument.
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
 * Selects an element (or none) and clears the style card; a pending style edit is saved first.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element, undefined to clear.
 */
export function selectElement(ctx: GameViewCtx, ref: ElementRef | undefined): void {
  const { state } = ctx;
  if (state.styles?.pending !== undefined) void saveStyle(ctx);
  state.selected = ref;
  state.styles = undefined;
  state.lookup = undefined;
  notify(state);
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
        ctx.log.warn("gameView: highlight failed", { message: messageOf(error) });
      }
    }
  );
}

/**
 * The scene node under a client point: through the frame box to page px, then the shared
 * elementAt. Nothing without a calibrated scene or a frame box.
 *
 * @param ctx - Domain context of gameView.
 * @param client - The pointer in client px.
 * @returns The node, or undefined.
 */
function nodeAt(ctx: GameViewCtx, client: ClientPoint): SceneNode | undefined {
  const { scene } = ctx.state;
  const workspace = ctx.require(workspacePlugin);
  const box = workspace.gameFrame().box();
  if (scene === undefined || !scene.calibrated || box === undefined || box.scale <= 0) {
    return undefined;
  }
  return elementAt(scene, pageFromClient(client, box));
}

/**
 * Picker hover: the node under the pointer becomes the hover box (undefined clears it).
 *
 * @param ctx - Domain context of gameView.
 * @param client - The pointer in client px; omitted when it left the layer.
 */
export function hoverAt(ctx: GameViewCtx, client?: ClientPoint): void {
  const hover = client === undefined ? undefined : nodeAt(ctx, client)?.id;
  if (ctx.state.picker.hover === hover) return;
  ctx.state.picker.hover = hover;
  notify(ctx.state);
}

/**
 * Picker click: selects the node under the pointer, turns the picker off, opens the Element tab.
 * A click on nothing keeps the picker on.
 *
 * @param ctx - Domain context of gameView.
 * @param client - The pointer in client px.
 */
export function pickAt(ctx: GameViewCtx, client: ClientPoint): void {
  const node = nodeAt(ctx, client);
  if (node === undefined) return;
  selectElement(ctx, node.ref);
  ctx.state.picker = { on: false, hover: undefined };
  ctx.state.tab = "element";
  notify(ctx.state);
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
 * "Open in Files": filesView shows the file at the line (R4).
 *
 * @param ctx - Domain context of gameView.
 * @param path - The file.
 * @param line - The 1-based line.
 */
export function openInFiles(ctx: GameViewCtx, path: string, line: number): void {
  ctx.emit("workspace:open-file", { path, line });
}
