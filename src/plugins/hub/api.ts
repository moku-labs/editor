/**
 * @file hub plugin — api factory: assembles serve, token, sessions, fetch, websocket, addRoutes,
 * guard, publish, closeAll and path from the modules. No logic of its own.
 */
import { publish } from "./routing/publish";
import { sessionList } from "./routing/sessions";
import { guard as checkRequest } from "./security/guard";
import { currentToken } from "./security/token";
import { handleUpgrade } from "./security/upgrade";
import { registerRoutes, serveWith } from "./serve";
import { closeAll } from "./sockets/close";
import { createSocketHandler } from "./sockets/handler";
import type { HubApi, HubCtx } from "./types";

/**
 * Creates the hub api. The member contracts live on HubApi in types.ts.
 *
 * @param ctx - Domain context of the hub.
 * @returns The HubApi (`app.hub`).
 */
export function createHubApi(ctx: HubCtx): HubApi {
  const websocket = createSocketHandler(ctx);

  return {
    serve: options => serveWith(ctx, options, websocket),
    token: () => currentToken(ctx.state.token),
    sessions: () => sessionList(ctx.state),
    fetch: (req, server) => handleUpgrade(ctx, req, server),
    websocket,
    addRoutes: routes => {
      registerRoutes(ctx, routes);
    },
    guard: (req, server, mode) => checkRequest(req, server, mode, ctx.state.origins),
    publish: (method, params) => {
      publish(ctx, method, params);
    },
    closeAll: (code, reason) => {
      closeAll(ctx, code, reason);
    },
    path: () => ctx.config.path
  };
}
