/**
 * @file pages plugin — hot reload (R6, D-23): the state of Bun HMR on the game server, set when
 * the bin attaches its server and published to the tools pages through `hub.publish`, and the
 * route `P/hmr` (GET the state; POST `{ hmr }` with the boot token as a Bearer). Bun 1.3.14 does
 * not switch HMR on a running server (`server.reload` keeps the first value, spike in README), so
 * a change is refused and the switch stays read-only.
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { BunServeOptions, HubServer, RouteHandler } from "../hub/types";
import type { HotReload } from "../registry/protocol";
import { badRequest, respond, textResponse } from "./http";
import type { PagesState, RouteDeps } from "./types";

/**
 * What the hot reload functions need: the hub (publish, guard, token), the state and the log.
 */
export type HotReloadDeps = Pick<RouteDeps, "hub" | "state" | "log">;

/**
 * The methods `P/hmr` answers.
 */
const HMR_ALLOW = "GET, HEAD, POST";

/**
 * The longest POST body accepted, in characters: `{"hmr":false}` needs 13.
 */
const MAX_BODY = 1024;

/**
 * The scheme of the Authorization header the POST carries.
 */
const BEARER = "Bearer ";

/**
 * Headers of every JSON answer of `P/hmr`. No CORS header, ever.
 */
const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

/**
 * Whether Bun runs HMR for a `development` serve option: on for `true` and for an object whose
 * `hmr` is not `false`; off for `false` and when the option is missing (the bin always passes it).
 *
 * @param development - The `development` value of the serve options.
 * @returns True when Bun reloads the page on a source change.
 * @example
 * ```ts
 * hmrOf({ hmr: true, console: true }); // true
 * hmrOf({ hmr: false }); // false
 * ```
 */
export function hmrOf(development: unknown): boolean {
  if (typeof development === "boolean") return development;
  if (typeof development !== "object" || development === null) return false;
  return !("hmr" in development) || development.hmr !== false;
}

/**
 * A fresh copy of the hot reload state: `{ hmr: false, owner: "server" }` until the bin attaches
 * its server.
 *
 * @param state - pages state.
 * @returns `{ hmr, owner }`.
 */
export function hotReloadOf(state: PagesState): HotReload {
  return { hmr: state.hot.hmr, owner: state.hot.owner };
}

/**
 * Sends the current state to every tools page (and keeps it for the ones that connect later).
 *
 * @param deps - Hub and state.
 */
function publishState(deps: HotReloadDeps): void {
  deps.hub.publish("hotReload", hotReloadOf(deps.state));
}

/**
 * The bin's server is attached: the bin owns hot reload, HMR is read from its serve options, and
 * the state is published.
 *
 * @param deps - Hub, state and log.
 * @param options - The options the bin passed to Bun.serve (the result of hub.serve).
 */
export function attachServer(deps: HotReloadDeps, options: BunServeOptions): void {
  deps.state.hot = { hmr: hmrOf(options.development), owner: "bin" };
  deps.log.info("pages:hot-reload", hotReloadOf(deps.state));
  publishState(deps);
}

/**
 * Asks for HMR on or off. Bun cannot switch it on a running server, so only the current value is
 * "applied": a game's own server always answers false, the bin answers true only when its HMR
 * already equals `on`. A refused change is logged at info. The state is published either way.
 *
 * @param deps - Hub, state and log.
 * @param on - The asked value.
 * @returns True when the bin owns the server and its HMR already equals `on`; false otherwise
 * (a game's own server always answers false).
 */
export function setHotReload(deps: HotReloadDeps, on: boolean): Promise<boolean> {
  const { hot } = deps.state;
  const applied = hot.owner === "bin" && hot.hmr === on;
  if (hot.owner === "bin" && !applied) {
    deps.log.info("pages:hot-reload-read-only", { hmr: hot.hmr });
  }
  publishState(deps);
  return Promise.resolve(applied);
}

/**
 * Timing-safe compare of the Bearer token of a request with the token of this start.
 *
 * @param req - The request.
 * @param token - hub.token().
 * @returns Whether the request carries `Authorization: Bearer <token>`.
 */
function hasToken(req: Request, token: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith(BEARER)) return false;

  const given = Buffer.from(header.slice(BEARER.length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The `hmr` of a POST body `{ hmr: boolean }`.
 *
 * @param text - The body text.
 * @returns The asked value, or undefined for any other body.
 * @example
 * ```ts
 * askedHmr('{"hmr":false}'); // false
 * askedHmr('{"hmr":"no"}'); // undefined
 * ```
 */
function askedHmr(text: string): boolean | undefined {
  if (text.length > MAX_BODY) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || !("hmr" in body)) return undefined;
    return typeof body.hmr === "boolean" ? body.hmr : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The state as a JSON answer.
 *
 * @param req - The request (HEAD drops the body).
 * @param deps - The state.
 * @param status - The HTTP status.
 * @returns The response.
 */
function stateAnswer(req: Request, deps: HotReloadDeps, status: number): Response {
  return respond(req, JSON.stringify(hotReloadOf(deps.state)), status, JSON_HEADERS);
}

/**
 * The token of this start, or undefined before start and after stop.
 *
 * @param deps - The hub.
 * @returns The token.
 */
function tokenOrUndefined(deps: HotReloadDeps): string | undefined {
  try {
    return deps.hub.token();
  } catch {
    return undefined;
  }
}

/**
 * The POST answer: 503 before start, 401 without the boot token, 400 for a bad body, else 200
 * with the state. A refused change (a game's own server, or a change Bun cannot make) also
 * answers 200: the caller compares the state with the asked value, and the page logs no error.
 *
 * @param req - The POST request (already guarded).
 * @param deps - Hub, state and log.
 * @returns The response.
 */
async function postAnswer(req: Request, deps: HotReloadDeps): Promise<Response> {
  const token = tokenOrUndefined(deps);
  if (token === undefined) return textResponse(req, 503, "editor not started");
  if (!hasToken(req, token)) return textResponse(req, 401, "unauthorized");

  const hmr = askedHmr(await req.text());
  if (hmr === undefined) return badRequest(req);

  await setHotReload(deps, hmr);
  return stateAnswer(req, deps, 200);
}

/**
 * The `P/hmr` route: `hub.guard(req, "same-origin")` first, then GET/HEAD answer the state and
 * POST asks for a change; any other method gets 405 with `Allow: GET, HEAD, POST`.
 *
 * @param deps - Hub, state and log.
 * @returns The route handler.
 */
export function hotReloadRoute(deps: HotReloadDeps): RouteHandler {
  return function route(req: Request, server: HubServer): Response | Promise<Response> {
    const refused = deps.hub.guard(req, server, "same-origin");
    if (refused) return refused;

    if (req.method === "GET" || req.method === "HEAD") return stateAnswer(req, deps, 200);
    if (req.method === "POST") return postAnswer(req, deps);
    return textResponse(req, 405, "method not allowed", { allow: HMR_ALLOW });
  };
}
