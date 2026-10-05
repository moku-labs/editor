/**
 * @file gameView plugin — a completed pick (round 2 R2) and "Copy reference". A pick (the picker
 * click, a Reference mode proxy click or MCP `moku_select`) bookmarks the game (`game.bookmark`,
 * kept newest first, 20 at most), captures the frame (`editor.capture`), saves the crop (JPEG,
 * A19) and the full frame under `capturesDir`, writes the card file with the full reference block
 * (round 2b R13), then puts the one reference line on the clipboard with one toast (not for MCP:
 * `copy: false`, A8), shows the capture card and publishes the selection with its files (U4).
 * Every command runs through panels.run (R9); a game without the command, or a step that fails,
 * leaves its lines out of the block and its word out of the toast. An area pick (U9) reuses the
 * bookmark and the shots.
 */
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import type { PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import { resolveDevice } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { cropImage } from "../capture/crop";
import { bookmarkId, deviceLabel, imageExtension, pickPaths } from "../capture/naming";
import { listTaken, shotOf, showCard } from "../capture/shot";
import { copyText } from "../clipboard";
import { GAME_COMMANDS, gameReady } from "../commands";
import { isSelected, pickedSelection, publishSelection } from "../element/publish";
import { messageOf } from "../report";
import { readScene } from "../scene/read";
import { notify } from "../state";
import type { GameViewCtx, PickBookmark, PickOptions, PickResult } from "../types";
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
 * A pick of the user: its line goes on the clipboard.
 */
const USER_PICK: PickOptions = { copy: true };

/**
 * A bookmark a pick took, with the tainted flag of its run.
 */
export type Taken = { readonly bookmark: PickBookmark; readonly tainted: boolean };

/**
 * The files a pick saved: the frame of the shot, the crop (when it could be cut) and the full
 * frame, with the thumbnail and the device text of its capture card.
 */
export type Shots = {
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
 * @param name - The name the bookmark is kept under: the picked key, or "area".
 * @returns The bookmark, undefined when the game has no game.bookmark or it failed (logged).
 */
export async function takeBookmark(ctx: GameViewCtx, name: string): Promise<Taken | undefined> {
  if (!gameReady(ctx.require(linkPlugin), BOOKMARK_COMMAND)) return undefined;
  try {
    const ran = await ctx.require(panelsPlugin).run(BOOKMARK_COMMAND);
    const { state } = ctx;
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
 * The crop of a rect from the shot, JPEG 0.8 (A19); only a calibrated scene has device px rects.
 *
 * @param ctx - Domain context of gameView.
 * @param rect - The picked element's rect or the area, undefined for an unplaced node.
 * @param scene - Its scene.
 * @param image - The data URL of the frame.
 * @returns The crop, undefined when it cannot be cut (a failure is logged).
 */
async function cropOf(
  ctx: GameViewCtx,
  rect: PageRect | undefined,
  scene: SceneSnapshot,
  image: string
): Promise<string | undefined> {
  if (!scene.calibrated || rect === undefined) return undefined;
  const { preset, orientation } = ctx.require(workspacePlugin).device();
  try {
    return await cropImage(image, rect, resolveDevice(preset, orientation));
  } catch (error) {
    ctx.log.warn("gameView: pick crop failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * Captures the frame for a pick and saves the crop and the full frame under `capturesDir`, each
 * named with the extension of its picture (`-crop.jpg`, `-full.jpg` by default).
 *
 * @param ctx - Domain context of gameView.
 * @param name - The name of the files: the picked key, or "area".
 * @param rect - The rect to crop to, undefined for none.
 * @param scene - The scene of the pick.
 * @returns The saved files, undefined when the game has no editor.capture or a step failed.
 */
export async function saveShots(
  ctx: GameViewCtx,
  name: string,
  rect: PageRect | undefined,
  scene: SceneSnapshot
): Promise<Shots | undefined> {
  const link = ctx.require(linkPlugin);
  if (!gameReady(link, GAME_COMMANDS.capture)) return undefined;
  try {
    // Capture the frame and check that the game sent a picture.
    const ran = await ctx.require(panelsPlugin).run(GAME_COMMANDS.capture);
    const shot = shotOf(ran.value);
    if (shot === undefined) {
      throw new Error(
        "[moku-editor] editor.capture returned no image.\n  Update the game's capturePlugin."
      );
    }

    // Crop the rect and name the files, each with the extension of its picture.
    const crop = await cropOf(ctx, rect, scene, shot.image);
    const { capturesDir } = ctx.config;
    const taken = await listTaken(ctx, capturesDir);
    const paths = pickPaths(capturesDir, name, shot.frame, taken, {
      crop: imageExtension(crop ?? shot.image),
      full: imageExtension(shot.image)
    });

    // Write the crop (when it could be cut), then the full frame.
    if (crop !== undefined) await link.files.writeBinary(paths.crop, crop);
    await link.files.writeBinary(paths.full, shot.image);

    // Describe the saved files for the capture card.
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
 * Shows the capture card of a pick's shot with its Reference action (round 2b R14).
 *
 * @param ctx - Domain context of gameView.
 * @param shots - The saved files, undefined when none were saved (no card then).
 * @param line - The reference line the card's Reference action copies.
 */
export function showPickCard(ctx: GameViewCtx, shots: Shots | undefined, line: string): void {
  if (shots === undefined) return;
  showCard(ctx, {
    path: shots.crop ?? shots.full,
    frame: shots.frame,
    device: shots.device,
    image: shots.thumb,
    reference: line
  });
}

/**
 * A completed pick: bookmark, shot, crop and full frame, the card file, then the one reference
 * line on the clipboard and one toast (`copy`, A8), the capture card of the shot with its
 * Reference action (round 2b R14), and the selection with its files published while the node is
 * still selected (U4). The block also stays the Element tab's while the node is selected.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The picked node.
 * @param scene - Its scene.
 * @param options - `copy: false` leaves the clipboard and the toast out (MCP select).
 * @returns The block, the line, the card, the crop, the full frame, the frame and the selection
 * (resolves when copied or toasted; never rejects).
 */
export async function completePick(
  ctx: GameViewCtx,
  node: SceneNode,
  scene: SceneSnapshot,
  options: PickOptions = USER_PICK
): Promise<PickResult> {
  const taken = await takeBookmark(ctx, nameOf(node));
  const shots = await saveShots(ctx, nameOf(node), node.rect, scene);
  const frame = shots?.frame ?? taken?.bookmark.frame ?? scene.frame;
  ctx.state.pick = {
    nodeId: node.id,
    frame,
    bookmark: taken?.bookmark.id,
    crop: shots?.crop,
    full: shots?.full,
    tainted: taken?.tainted
  };
  notify(ctx.state);

  const shared = await shareReference(ctx, node, scene, true);
  if (options.copy) {
    await copyText(ctx, shared.line, pickToast(shots !== undefined, taken !== undefined));
  }
  showPickCard(ctx, shots, shared.line);

  const files = { card: shared.card, crop: shots?.crop };
  const info = pickedSelection(ctx, node, { frame, ...files, line: shared.line });
  if (isSelected(ctx, node)) publishSelection(ctx, info);
  return { block: shared.block, line: shared.line, ...files, full: shots?.full, frame, info };
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
