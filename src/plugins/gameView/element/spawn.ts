/**
 * @file gameView plugin — where the projection that spawns an entity is defined (round 2b R12):
 * the project index's first answer of `projection:<key>`, the key being the entity's owner in
 * game.projections (the line of its `name: "<key>"`). A found place is kept per key in
 * `state.spawns` until a project change touches its file; a key the index does not know is asked
 * again.
 */
import { linkPlugin } from "../../link";
import type { BlockAt, GameViewCtx } from "../types";

/**
 * The first answer of `projection:<name>`.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The projection key.
 * @returns The file and line, undefined when the index has no answer or cannot be asked.
 */
async function locateProjection(ctx: GameViewCtx, name: string): Promise<BlockAt | undefined> {
  try {
    const [found] = await ctx.require(linkPlugin).files.find(`projection:${name}`);
    return found === undefined ? undefined : { path: found.path, line: found.line };
  } catch {
    return undefined;
  }
}

/**
 * Where the projection that spawns an entity is defined. A found place is kept, and a second ask
 * while the first runs gets the same answer; a key the index does not know is asked again next
 * time.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The projection key (the entity's owner).
 * @returns The file and line, undefined when the index has no answer.
 */
export function findProjectionSource(ctx: GameViewCtx, name: string): Promise<BlockAt | undefined> {
  const { spawns } = ctx.state;
  const known = spawns.get(name);
  if (known !== undefined) return known.asked;

  const asked = locateProjection(ctx, name).then(found => {
    // A project change may have dropped this ask meanwhile; then nothing is kept.
    const spawn = spawns.get(name);
    if (spawn?.asked !== asked) return found;
    if (found === undefined) spawns.delete(name);
    else spawn.at = found;
    return found;
  });
  spawns.set(name, { asked, at: undefined });
  return asked;
}
