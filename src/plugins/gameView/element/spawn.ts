/**
 * @file gameView plugin — where the projection that spawns an entity is defined (round 2b R12):
 * the projection key of game.projections (the entity's owner) is looked for as `name: "<key>"`
 * over the same source files as a ui key. A line within three lines of a `projection(` call wins;
 * else the first line that names it. A found place is kept per key in `state.spawns`.
 */
import type { BlockAt, GameViewCtx } from "../types";
import { readText, sourceFiles } from "./source";

/**
 * Regex special characters of a projection key ("board.items").
 */
const REGEX_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

/**
 * The lines above a `name:` line where the `projection(` call may open.
 */
const CALL_LINES = 3;

/**
 * The call that defines a projection.
 */
const PROJECTION_CALL = "projection(";

/**
 * Where a file names a projection key.
 */
type NameMatch = { readonly line: number; readonly inCall: boolean };

/**
 * The line that names a projection key in a file: the first one inside a `projection({…})` call,
 * else the first one at all.
 *
 * @param text - A file text.
 * @param name - The projection key.
 * @returns The 1-based line and whether a `projection(` call holds it; undefined when no line
 * names the key.
 * @example
 * ```ts
 * matchProjection('export const hud = projection({\n  name: "hud",', "hud"); // { line: 2, inCall: true }
 * ```
 */
export function matchProjection(text: string, name: string): NameMatch | undefined {
  const escaped = name.replaceAll(REGEX_SPECIAL, String.raw`\$&`);
  const pattern = new RegExp(String.raw`(?<![\w$.-])name:\s*(?:"${escaped}"|'${escaped}')`);
  const lines = text.split("\n");
  let first: NameMatch | undefined;
  for (const [index, line] of lines.entries()) {
    if (!pattern.test(line)) continue;
    const above = lines.slice(Math.max(0, index - CALL_LINES), index + 1);
    if (above.some(entry => entry.includes(PROJECTION_CALL)))
      return { line: index + 1, inCall: true };
    first ??= { line: index + 1, inCall: false };
  }
  return first;
}

/**
 * One search of a projection key over the source files.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The projection key.
 * @returns The file and line, undefined when no file names it.
 */
async function searchProjection(ctx: GameViewCtx, name: string): Promise<BlockAt | undefined> {
  let first: BlockAt | undefined;
  for await (const path of sourceFiles(ctx)) {
    const text = await readText(ctx, path);
    const match = text === undefined ? undefined : matchProjection(text, name);
    if (match === undefined) continue;
    if (match.inCall) return { path, line: match.line };
    first ??= { path, line: match.line };
  }
  return first;
}

/**
 * Where the projection that spawns an entity is defined. A found place is kept, and a second ask
 * while the search runs gets the same search; a key no file names is searched again next time.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The projection key (the entity's owner).
 * @returns The file and line, undefined when no file names it.
 */
export function findProjectionSource(ctx: GameViewCtx, name: string): Promise<BlockAt | undefined> {
  const { spawns } = ctx.state;
  const known = spawns.get(name);
  if (known !== undefined) return known;

  const search = searchProjection(ctx, name).then(found => {
    if (found === undefined) spawns.delete(name);
    return found;
  });
  spawns.set(name, search);
  return search;
}
