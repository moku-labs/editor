/**
 * @file gameView plugin — the game's texture catalogue: the asset manifest the project index
 * names (`ProjectState.manifest`, D-38), read through link.files and parsed with the shared
 * parseTextureManifest (R8). Cached until a new session or a project change drops it (`null`
 * remembers "none": the index is off, names no manifest, or it does not parse).
 */
import { linkPlugin } from "../../link";
import { manifestOf } from "../../panels/shared/project";
import type { TextureCatalogue } from "../../panels/shared/scene";
import { parseTextureManifest } from "../../panels/shared/scene";
import { notify } from "../state";
import type { GameViewCtx } from "../types";

/**
 * Reads the manifest the index names; a missing or unreadable file is undefined.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The manifest path.
 * @returns The catalogue, or undefined.
 */
async function readCatalogue(
  ctx: GameViewCtx,
  path: string
): Promise<TextureCatalogue | undefined> {
  try {
    const file = await ctx.require(linkPlugin).files.read(path);
    return parseTextureManifest(file.text, path);
  } catch {
    return undefined;
  }
}

/**
 * The texture catalogue of the game, cached.
 *
 * @param ctx - Domain context of gameView.
 * @returns The catalogue, undefined when the index names no readable manifest.
 */
export async function readManifest(ctx: GameViewCtx): Promise<TextureCatalogue | undefined> {
  const { state } = ctx;
  if (state.manifest !== undefined) return state.manifest ?? undefined;

  const path = manifestOf(ctx.require(linkPlugin).project());
  const catalogue = path === undefined ? undefined : await readCatalogue(ctx, path);
  // eslint-disable-next-line unicorn/no-null -- null is the spec's "looked, not found" marker
  state.manifest = catalogue ?? null;
  notify(state);
  return catalogue;
}
