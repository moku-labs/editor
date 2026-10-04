/**
 * @file gameView plugin — the text style key block of a text node (round 2b R17): a text node
 * with `style="ui.link"` names a key of the game's text-style table. The table is in the file
 * that calls `defineTextStyles(` (the search of panels/shared/styles-file, once per app,
 * remembered in `state.textStyles`); the shared style edit finds the key's block there. A remembered file that
 * is gone is searched for again once. Nothing here throws: what cannot be read is left out.
 */
import { linkPlugin } from "../../link";
import { findBlock, isStyleEditError, loadStyleFile } from "../../panels/shared/style-edit";
import { findStylesFile } from "../../panels/shared/styles-file";
import type { GameViewCtx, StyleSnippet } from "../types";

/**
 * The file that calls `defineTextStyles(`: the search of this app, started once and shared; a
 * search that finds none or fails is forgotten, so the next ask searches again.
 *
 * @param ctx - Domain context of gameView.
 * @returns The path, undefined when no file calls the definer.
 */
function textStylesFile(ctx: GameViewCtx): Promise<string | undefined> {
  const { state } = ctx;
  if (state.textStyles !== undefined) return state.textStyles;

  const search = findStylesFile(ctx.require(linkPlugin).files).then(
    path => {
      if (path === undefined && state.textStyles === search) state.textStyles = undefined;
      return path;
    },
    (error: unknown) => {
      if (state.textStyles === search) state.textStyles = undefined;
      throw error;
    }
  );
  state.textStyles = search;
  return search;
}

/**
 * The block of a text style key in the styles file: its lines with the key as its name.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key ("ui.link").
 * @returns The block, undefined when no file calls the definer, the file does not parse or has
 * no such key, or a read fails.
 */
export async function textStyleOf(
  ctx: GameViewCtx,
  key: string
): Promise<StyleSnippet | undefined> {
  try {
    const files = ctx.require(linkPlugin).files;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const path = await textStylesFile(ctx);
      if (path === undefined) return undefined;

      const loaded = await loadStyleFile(files, path);
      if (isStyleEditError(loaded) && loaded.error === "no-file") {
        ctx.state.textStyles = undefined;
        continue;
      }
      const block = isStyleEditError(loaded)
        ? loaded
        : findBlock(loaded.file, { kind: "text", key });
      if (isStyleEditError(loaded) || isStyleEditError(block)) return undefined;
      const lines = loaded.text.split("\n").slice(block.line - 1, block.endLine);
      return { path, line: block.line, lines, name: key };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
