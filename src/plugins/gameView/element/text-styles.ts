/**
 * @file gameView plugin — the text style key block of a text node (round 2b R17): a text node
 * with `style="ui.link"` names a key of the game's text-style table, and the project index
 * answers where that key is (`find("textStyle:<key>")`): the lines of its range. Nothing here
 * throws: what the index does not know or what cannot be read is left out.
 */
import { linkPlugin } from "../../link";
import { findFresh } from "../../panels/shared/project";
import type { GameViewCtx, StyleSnippet } from "../types";
import { snippetOf } from "./jsx";

/**
 * The block of a text style key: its lines with the key as its name.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key ("ui.link").
 * @returns The block, undefined when the index has no answer or its file cannot be read.
 */
export async function textStyleOf(
  ctx: GameViewCtx,
  key: string
): Promise<StyleSnippet | undefined> {
  const fresh = await findFresh(ctx.require(linkPlugin).files, `textStyle:${key}`);
  if (fresh === undefined) return undefined;
  const { found, text } = fresh;
  return { ...snippetOf(found.path, text, found.range), name: key };
}
