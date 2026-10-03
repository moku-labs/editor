/**
 * @file hub plugin — api factory: assembles serve, token, sessions, fetch, websocket, addRoutes,
 * guard and path from the modules. No logic of its own.
 */
import { sessionList } from "./routing/sessions";
import { guard as checkRequest } from "./security/guard";
import { currentToken } from "./security/token";
import { handleUpgrade } from "./security/upgrade";
import { registerRoutes, serveWith } from "./serve";
import { createSocketHandler } from "./sockets/handler";
import type { HubApi, HubCtx } from "./types";

/**
 * Creates the hub api.
 *
 * @param ctx - Domain context of the hub.
 * @returns The HubApi (`app.hub`).
 * @example
 * ```ts
 * createHubApi(ctx).path(); // "/__editor"
 * ```
 */
export function createHubApi(ctx: HubCtx): HubApi {
  const websocket = createSocketHandler(ctx);

  return {
    /**
     * Wraps Bun.serve options: 127.0.0.1 forced, editor routes and the websocket handler added.
     *
     * @param options - The game's serve options.
     * @returns Options ready for Bun.serve.
     * @example
     * ```ts
     * Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index } }));
     * ```
     */
    serve(options) {
      return serveWith(ctx, options, websocket);
    },

    /**
     * The token of this start. Throws before start and after stop.
     *
     * @returns The token.
     * @example
     * ```ts
     * const token = editor.hub.token();
     * ```
     */
    token() {
      return currentToken(ctx.state.token);
    },

    /**
     * Fresh SessionInfo list ordered by connectedAt.
     *
     * @returns The open sessions.
     * @example
     * ```ts
     * editor.hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", … }]
     * ```
     */
    sessions() {
      return sessionList(ctx.state);
    },

    /**
     * The `{path}/ws` upgrade handler.
     *
     * @param req - The request.
     * @param server - The Bun server.
     * @returns undefined after an upgrade, else the refusal.
     * @example
     * ```ts
     * fetch: (req, server) => editor.hub.fetch(req, server) ?? new Response("upgraded")
     * ```
     */
    fetch(req, server) {
      return handleUpgrade(ctx, req, server);
    },

    websocket,

    /**
     * Registers editor routes (pages, in onInit), merged by serve (R3).
     *
     * @param routes - Routes keyed under the editor path.
     * @example
     * ```ts
     * editor.hub.addRoutes({ "/__editor/hello": helloRoute });
     * ```
     */
    addRoutes(routes) {
      registerRoutes(ctx, routes);
    },

    /**
     * The shared Host / Origin / Sec-Fetch-Site check (R3).
     *
     * @param req - The request.
     * @param server - The Bun server.
     * @param mode - Which rules apply.
     * @returns A 403 response, or undefined when allowed.
     * @example
     * ```ts
     * const refused = editor.hub.guard(req, server, "same-origin");
     * ```
     */
    guard(req, server, mode) {
      return checkRequest(req, server, mode, ctx.state.origins);
    },

    /**
     * config.path (R3).
     *
     * @returns The editor path, e.g. "/__editor".
     * @example
     * ```ts
     * editor.hub.path(); // "/__editor"
     * ```
     */
    path() {
      return ctx.config.path;
    }
  };
}
