/**
 * @file gameView plugin — a completed pick (round 2 R2) and "Copy reference". A pick (the picker
 * click or a Reference mode proxy click) bookmarks the game (`game.bookmark`, kept newest first,
 * 20 at most), captures the frame (`editor.capture`), saves the crop and the full frame under
 * `capturesDir`, writes the card file with the full reference block (round 2b R13), then puts
 * the one reference line on the clipboard with one toast. Every command runs through panels.run
 * (R9); a game without the command, or a step that fails, leaves its lines out of the block and
 * its word out of the toast.
 */
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import type { SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import { resolveDevice } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { cropImage } from "../capture/crop";
import { bookmarkId, deviceLabel, pickPaths } from "../capture/naming";
import { listTaken, shotOf, showCard } from "../capture/shot";
import { copyText } from "../clipboard";
import { GAME_COMMANDS, gameReady } from "../commands";
import { messageOf } from "../report";
import { readScene } from "../scene/read";
import { notify } from "../state";
import type { GameViewCtx, PickBookmark } from "../types";
import { nameOf, shareReference } from "./card";

/**
 * The bookmarks a session keeps.
 */
const BOOKMARKS_KEPT = 20;

/**
 * The door command a pick bookmarks the game with.
 */
const BOOKMARK_COMMAND = "game.bookmark";

/**
 * The toast of "Copy reference".
 */
const COPIED_TEXT = "✓ Reference copied";

/**
 * A bookmark a pick took, with the tainted flag of its run.
 */
type Taken = { readonly bookmark: PickBookmark; readonly tainted: boolean };

/**
 * The files a pick saved: the frame of the shot, the crop (when it could be cut) and the full
 * frame, with the thumbnail and the device text of its capture card.
 */
type Shots = {
  readonly frame: number;
  readonly crop: string | undefined;
  readonly full: string;
  /** The crop, else the full frame, as a data URL. */
  readonly thumb: string;
  /** "iPhone 15 portrait". */
  readonly device: string;
};

/**
 * Bookmarks the game for a pick and keeps the bookmark (newest first, at most 20).
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @returns The bookmark, undefined when the game has no game.bookmark or it failed (logged).
 */
async function takeBookmark(ctx: GameViewCtx, node: SceneNode): Promise<Taken | undefined> {
  if (!gameReady(ctx.require(linkPlugin), BOOKMARK_COMMAND)) return undefined;
  try {
    const ran = await ctx.require(panelsPlugin).run(BOOKMARK_COMMAND);
    const { state } = ctx;
    const name = nameOf(node);
    const ids = new Set(state.bookmarks.map(entry => entry.id));
    const bookmark: PickBookmark = {
      id: bookmarkId(name, ran.state.frame, ids),
      frame: ran.state.frame,
      key: name,
      at: Date.now(),
      value: ran.value
    };
    state.bookmarks = [bookmark, ...state.bookmarks].slice(0, BOOKMARKS_KEPT);
    return { bookmark, tainted: ran.state.tainted };
  } catch (error) {
    ctx.log.warn("gameView: pick bookmark failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * The crop of the picked element from the shot; only a calibrated scene has device px rects.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @param scene - Its scene.
 * @param image - The PNG data URL of the frame.
 * @returns The crop, undefined when it cannot be cut (a failure is logged).
 */
async function cropOf(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot,
  image: string
): Promise<string | undefined> {
  if (!scene.calibrated || node.rect === undefined) return undefined;
  const { preset, orientation } = ctx.require(workspacePlugin).device();
  try {
    return await cropImage(image, node.rect, resolveDevice(preset, orientation));
  } catch (error) {
    ctx.log.warn("gameView: pick crop failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * Captures the frame for a pick and saves the crop and the full frame under `capturesDir`.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @param scene - Its scene.
 * @returns The saved files, undefined when the game has no editor.capture or a step failed.
 */
async function saveShots(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot
): Promise<Shots | undefined> {
  const link = ctx.require(linkPlugin);
  if (!gameReady(link, GAME_COMMANDS.capture)) return undefined;
  try {
    const ran = await ctx.require(panelsPlugin).run(GAME_COMMANDS.capture);
    const shot = shotOf(ran.value);
    if (shot === undefined) {
      throw new Error(
        "[moku-editor] editor.capture returned no image.\n  Update the game's capturePlugin."
      );
    }
    const crop = await cropOf(ctx, node, scene, shot.image);
    const { capturesDir } = ctx.config;
    const taken = await listTaken(ctx, capturesDir);
    const paths = pickPaths(capturesDir, nameOf(node), shot.frame, taken);
    if (crop !== undefined) await link.files.writeBinary(paths.crop, crop);
    await link.files.writeBinary(paths.full, shot.image);
    const { preset } = ctx.require(workspacePlugin).device();
    return {
      frame: shot.frame,
      crop: crop === undefined ? undefined : paths.crop,
      full: paths.full,
      thumb: crop ?? shot.image,
      device: deviceLabel(preset.name, shot.device.orientation)
    };
  } catch (error) {
    ctx.log.warn("gameView: pick shot failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * The toast of a pick: what went on the clipboard besides the reference.
 *
 * @param shot - The shot was saved.
 * @param bookmark - The bookmark was taken.
 * @returns "Reference, shot and bookmark copied", "Reference and shot copied" …
 * @example
 * ```ts
 * pickToast(true, true); // "Reference, shot and bookmark copied"
 * ```
 */
export function pickToast(shot: boolean, bookmark: boolean): string {
  const parts = ["Reference", ...(shot ? ["shot"] : []), ...(bookmark ? ["bookmark"] : [])];
  const last = parts.pop();
  return parts.length === 0 ? `${last} copied` : `${parts.join(", ")} and ${last} copied`;
}

/**
 * A completed pick: bookmark, shot, crop and full frame, the card file, then the one reference
 * line on the clipboard and one toast, and the capture card of the shot with its Reference
 * action (round 2b R14). The block also stays the Element tab's while the node is selected.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @param scene - Its scene.
 * @returns The full block (resolves when copied or toasted; never rejects).
 */
export async function completePick(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot
): Promise<string> {
  const taken = await takeBookmark(ctx, node);
  const shots = await saveShots(ctx, node, scene);
  ctx.state.pick = {
    nodeId: node.id,
    frame: shots?.frame ?? taken?.bookmark.frame ?? scene.frame,
    bookmark: taken?.bookmark.id,
    crop: shots?.crop,
    full: shots?.full,
    tainted: taken?.tainted
  };
  notify(ctx.state);

  const shared = await shareReference(ctx, node, scene, true);
  await copyText(ctx, shared.line, pickToast(shots !== undefined, taken !== undefined));
  if (shots !== undefined) {
    showCard(ctx, {
      path: shots.crop ?? shots.full,
      frame: shots.frame,
      device: shots.device,
      image: shots.thumb,
      reference: shared.line
    });
  }
  return shared.block;
}

/**
 * The scene "Copy reference" builds from: the one there is, else one read.
 *
 * @param ctx - Domain context of gameView.
 * @returns The scene, undefined when it cannot be read.
 */
async function sceneNow(ctx: GameViewCtx): Promise<SceneSnapshot | undefined> {
  if (ctx.state.scene !== undefined) return ctx.state.scene;
  try {
    return await readScene(ctx);
  } catch (error) {
    ctx.log.debug("gameView: copy reference read failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * "Copy reference": writes the card of the selected element and puts its one line on the
 * clipboard (a refusal is toasted).
 *
 * @param ctx - Domain context of gameView.
 * @returns The line, undefined without a selection in the scene.
 */
export async function copySelectedReference(ctx: GameViewCtx): Promise<string | undefined> {
  const { selected } = ctx.state;
  if (selected === undefined) return undefined;
  const scene = await sceneNow(ctx);
  const node = scene?.nodes.get(refId(selected));
  if (scene === undefined || node === undefined) return undefined;

  const shared = await shareReference(ctx, node, scene, false);
  await copyText(ctx, shared.line, COPIED_TEXT);
  return shared.line;
}

/**
 * The pick bookmarks, newest first.
 *
 * @param ctx - Domain context of gameView.
 * @returns A copy of the list.
 */
export function listBookmarks(ctx: Pick<GameViewCtx, "state">): readonly PickBookmark[] {
  return [...ctx.state.bookmarks];
}
