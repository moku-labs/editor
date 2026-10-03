/**
 * @file hub plugin — `serve(options)` (design API 2B): wraps the game's Bun.serve options with
 * 127.0.0.1 forced, the editor routes (registered by `addRoutes`, plus `{path}/ws`) merged in and
 * the one websocket handler. Holds the one isolated cast of the package's Bun seam.
 */
import { handleUpgrade } from "./security/upgrade";
import type {
  BunServeOptions,
  EditorRoutes,
  HubCtx,
  HubServer,
  HubWebSocketHandler,
  MergedServeOptions,
  RouteHandler,
  ServeOptions
} from "./types";

/**
 * The only address the editor binds.
 */
const LOOPBACK = "127.0.0.1";

/**
 * Hostnames that mean the loopback address.
 */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set([LOOPBACK, "localhost"]);

/**
 * A startup error in the spec/11 Part 3 format with the editor prefix (R7).
 *
 * @param problem - What is wrong, without the final period.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw serveError("hub.serve() runs once per app", "Pass every route to one hub.serve() call");
 * ```
 */
function serveError(problem: string, fix: string): Error {
  return new Error(`[moku-editor] ${problem}.\n  ${fix}.`);
}

/**
 * True for a route key the editor owns: the path itself or anything under `path/`.
 *
 * @param path - config.path.
 * @param key - A route key.
 * @returns Whether the key is an editor route.
 * @example
 * ```ts
 * isEditorKey("/__editor", "/__editor/hello"); // true
 * ```
 */
function isEditorKey(path: string, key: string): boolean {
  return key === path || key.startsWith(`${path}/`);
}

/**
 * The game's fetch fallback when it passes none.
 *
 * @returns A 404.
 * @example
 * ```ts
 * const fetch = options.fetch ?? notFound;
 * ```
 */
function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

/**
 * The `{path}/ws` route: the upgrade handler bound to the hub context.
 *
 * @param ctx - Domain context of the hub.
 * @returns The route handler.
 * @example
 * ```ts
 * routes[`${path}/ws`] = upgradeRoute(ctx);
 * ```
 */
function upgradeRoute(ctx: HubCtx): RouteHandler {
  return function upgrade(req: Request, server: HubServer): Response | undefined {
    return handleUpgrade(ctx, req, server);
  };
}

/**
 * Registers editor routes for serve() to merge (R3; pages calls it in onInit). Keys are checked
 * first, so a refused batch registers nothing.
 *
 * @param ctx - Domain context of the hub.
 * @param routes - Editor routes, keyed under config.path.
 * @throws {Error} After serve(), on a key registered before, on `{path}/ws`, or on a key outside
 * the editor path.
 * @example
 * ```ts
 * registerRoutes(ctx, { "/__editor/hello": helloRoute });
 * ```
 */
export function registerRoutes(ctx: HubCtx, routes: EditorRoutes): void {
  const { state, config } = ctx;
  if (state.served) {
    throw serveError(
      "hub.addRoutes() ran after hub.serve()",
      "Register editor routes in onInit, before the server starts"
    );
  }

  for (const key of Object.keys(routes)) {
    if (key === `${config.path}/ws` || !isEditorKey(config.path, key)) {
      throw serveError(
        `hub.addRoutes() refuses the key "${key}": editor routes live under ${config.path} and ${config.path}/ws is the socket`,
        `Use a key like "${config.path}/hello"`
      );
    }
    if (state.routes.has(key)) {
      throw serveError(
        `hub.addRoutes() got the key "${key}" twice`,
        "Register each editor route once"
      );
    }
  }

  for (const [key, route] of Object.entries(routes)) state.routes.set(key, route);
}

/**
 * Checks the game's options against the editor's rules.
 *
 * @param ctx - Domain context of the hub.
 * @param options - The game's serve options.
 * @throws {Error} Before start, on a second call, on a websocket handler, on unix or tls, on a
 * hostname other than 127.0.0.1 / localhost, or on a game route under the editor path.
 * @example
 * ```ts
 * checkServeOptions(ctx, options);
 * ```
 */
function checkServeOptions(ctx: HubCtx, options: ServeOptions): void {
  const { state, config } = ctx;
  if (state.token === undefined) {
    throw serveError(
      "hub.serve() needs a started app",
      "Call await editor.start() before hub.serve()"
    );
  }
  if (state.served) {
    throw serveError("hub.serve() runs once per app", "Pass every route to one hub.serve() call");
  }
  if (options.websocket !== undefined) {
    throw serveError(
      "hub.serve() refuses a websocket handler: the editor owns the one Bun allows",
      "Remove websocket from the serve options"
    );
  }
  if ("unix" in options || "tls" in options) {
    throw serveError(
      "hub.serve() refuses unix and tls: the Host and Origin checks need http://127.0.0.1:<port>",
      "Remove unix and tls from the serve options"
    );
  }

  const { hostname } = options;
  if (hostname !== undefined && !LOOPBACK_NAMES.has(hostname)) {
    throw serveError(
      `hub.serve() refuses hostname "${hostname}": the editor binds 127.0.0.1 only`,
      'Remove hostname or pass "127.0.0.1"'
    );
  }

  for (const key of Object.keys(options.routes ?? {})) {
    if (!isEditorKey(config.path, key)) continue;
    throw serveError(
      `hub.serve() refuses the game route "${key}": it is under the editor path ${config.path}`,
      "Move the route or change pluginConfigs.hub.path"
    );
  }
}

/**
 * Builds the serve options: the game's options with hostname 127.0.0.1, the game routes, the
 * registered editor routes and `{path}/ws` (a route, so a game wildcard cannot shadow it), the
 * game's fetch or a 404, and the hub websocket handler. Marks the hub as served.
 *
 * @param ctx - Domain context of the hub.
 * @param options - The game's serve options.
 * @param websocket - The hub websocket handler.
 * @returns The merged options.
 * @throws {Error} See checkServeOptions.
 * @example
 * ```ts
 * mergeServeOptions(ctx, { port: 3000, routes: { "/": index } }, websocket).hostname; // "127.0.0.1"
 * ```
 */
export function mergeServeOptions(
  ctx: HubCtx,
  options: ServeOptions,
  websocket: HubWebSocketHandler
): MergedServeOptions {
  checkServeOptions(ctx, options);

  const { state, config } = ctx;
  const routes = {
    ...options.routes,
    ...Object.fromEntries(state.routes),
    [`${config.path}/ws`]: upgradeRoute(ctx)
  };
  state.served = true;

  return { ...options, hostname: LOOPBACK, routes, fetch: options.fetch ?? notFound, websocket };
}

/**
 * Wraps the game's Bun.serve options (design API 2B).
 *
 * @param ctx - Domain context of the hub.
 * @param options - The game's own serve options (routes, fetch, port, development).
 * @param websocket - The hub websocket handler.
 * @returns Options ready for Bun.serve.
 * @throws {Error} Before start, on a second call, on hostname other than 127.0.0.1/localhost, on
 * unix/tls, on a websocket or a route under the editor path.
 * @example
 * ```ts
 * Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
 * ```
 */
export function serveWith(
  ctx: HubCtx,
  options: ServeOptions,
  websocket: HubWebSocketHandler
): BunServeOptions {
  // The one isolated cast of the hub. Bun types `routes`, `fetch` and `websocket` as an XOR of
  // option shapes, and a route that upgrades returns undefined, which its route type does not
  // allow: https://github.com/oven-sh/bun/issues/17871, https://github.com/oven-sh/bun/issues/18314
  return mergeServeOptions(ctx, options, websocket) as unknown as BunServeOptions;
}
