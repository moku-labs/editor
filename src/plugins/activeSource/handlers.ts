/**
 * @file activeSource plugin — hooks: the global `link:status`, so a choice made elsewhere (the
 * session menu of an older build, a test, link's own pick) becomes the source (spec 11 § 4 B8).
 */
import { followChoice } from "./sessions";
import type { ActiveSourceCtx, ActiveSourceHooks } from "./types";

/**
 * activeSource's hooks factory (`hooks: createActiveSourceHooks`): `link:status` with a session
 * this plugin did not choose adopts it.
 *
 * @param ctx - Domain context of activeSource.
 * @returns The hooks.
 */
export function createActiveSourceHooks(ctx: ActiveSourceCtx): ActiveSourceHooks {
  return {
    "link:status": ({ session }) => {
      if (session !== undefined) followChoice(ctx, session);
    }
  };
}
