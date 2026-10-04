/**
 * @file pages plugin — api factory: routes(), attachServer(), hotReload(), setHotReload().
 */
import { hubPlugin } from "../hub";
import type { HotReloadDeps } from "./hot-reload";
import { attachServer, hotReloadOf, setHotReload } from "./hot-reload";
import type { PagesApi, PagesCtx } from "./types";

/**
 * Creates the pages api. The member contract lives on PagesApi in types.ts.
 *
 * @param ctx - Domain context of pages.
 * @returns The PagesApi (`app.pages`).
 */
export function createPagesApi(ctx: PagesCtx): PagesApi {
  /**
   * The hot reload deps: the hub, resolved on first use.
   *
   * @returns Hub, state and log.
   */
  const hotDeps = (): HotReloadDeps => ({
    hub: ctx.require(hubPlugin),
    state: ctx.state,
    log: ctx.log
  });

  return {
    routes: () => ({ ...ctx.state.routes }),
    // The server argument is not used: Bun cannot switch HMR through server.reload (README).
    attachServer: (_server, options) => {
      attachServer(hotDeps(), options);
    },
    hotReload: () => hotReloadOf(ctx.state),
    setHotReload: on => setHotReload(hotDeps(), on)
  };
}
