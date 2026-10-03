/**
 * @file gameView plugin — the game's texture catalogue: the first readable `manifestPaths` entry
 * through link.files, parsed with the shared parseTextureManifest (R8), cached for the session
 * (`null` remembers "not found").
 */
import { linkPlugin } from "../../link";
import type { TextureCatalogue } from "../../panels/shared/scene";
import { parseTextureManifest } from "../../panels/shared/scene";
import { notify } from "../state";
import type { GameViewCtx } from "../types";

/**
 * Reads one manifest candidate; a missing or unreadable file is undefined.
 *
 * @param ctx - Domain context of gameView.
 * @param path - A candidate path.
 * @returns The catalogue, or undefined.
 * @example
 * ```ts
 * await readCandidate(ctx, "public/manifest.json"); // { path: "public/manifest.json", textures, bundles }
 * ```
 */
async function readCandidate(
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
 * The texture catalogue of the game, cached for the session.
 *
 * @param ctx - Domain context of gameView.
 * @returns The catalogue, undefined when no manifest was found.
 * @example
 * ```ts
 * (await readManifest(ctx))?.textures.get("board.cell")?.gpuMb; // 4
 * ```
 */
export async function readManifest(ctx: GameViewCtx): Promise<TextureCatalogue | undefined> {
  const { state } = ctx;
  if (state.manifest !== undefined) return state.manifest ?? undefined;

  for (const path of ctx.config.manifestPaths) {
    const catalogue = await readCandidate(ctx, path);
    if (catalogue !== undefined) {
      state.manifest = catalogue;
      notify(state);
      return catalogue;
    }
  }
  // eslint-disable-next-line unicorn/no-null -- null is the spec's "looked, not found" marker
  state.manifest = null;
  notify(state);
  return undefined;
}
