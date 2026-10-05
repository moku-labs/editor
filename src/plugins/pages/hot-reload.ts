/**
 * @file pages plugin — hot reload (R6, D-23, D-32): the state of Bun HMR on the game server, set
 * when the bin attaches its server and published to the tools pages through `hub.publish`, and
 * the route `P/hmr` (GET the state; POST `{ hmr }` with the boot token as a Bearer). Bun does not
 * switch HMR on a running server (`server.reload` keeps the first value, spike in README), so a
 * change restarts the bin's server with HMR flipped on the same port: the asked state is set and
 * published at once, and the restart runs after the answer went out (A1). A failed restart puts
 * the old state back and serves the old options again.
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { BunServeOptions, HubServer, RouteHandler } from "../hub/types";
import type { HotReload } from "../registry/protocol";
import { badRequest, respond, textResponse } from "./http";
import type { PagesState, RestartServer, RouteDeps } from "./types";

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
 * The serve options with Bun HMR on or off; the other `development` fields are kept.
 *
 * @param options - The current serve options.
 * @param on - HMR on or off.
 * @returns The next serve options.
 * @example
 * ```ts
 * withHmr({ port: 3000, development: { hmr: true, console: true } }, false);
 * // { port: 3000, development: { hmr: false, console: true } }
 * ```
 */
export function withHmr(options: BunServeOptions, on: boolean): BunServeOptions {
  const { development } = options;
  const kept = typeof development === "object" ? development : {};
  return { ...options, development: { ...kept, hmr: on } };
}

/**
 * The message of any thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("port 3000 is in use")); // "port 3000 is in use"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps the bin's options and restart, makes the bin the owner with the HMR of those options,
 * and publishes the state.
 *
 * @param deps - Hub, state and log.
 * @param options - The bin's serve options.
 * @param restart - The bin's restart, if any.
 */
function serveState(
  deps: HotReloadDeps,
  options: BunServeOptions,
  restart: RestartServer | undefined
): void {
  deps.state.served = { options, restart };
  deps.state.hot = { hmr: hmrOf(options.development), owner: "bin" };
  publishState(deps);
}

/**
 * The bin's server is attached: the bin owns hot reload, HMR is read from its serve options, and
 * the state is published. With the bin's restart, a change can be switched (D-32).
 *
 * @param deps - Hub, state and log.
 * @param options - The options the bin passed to Bun.serve (the result of hub.serve).
 * @param restart - The bin's restart.
 */
export function attachServer(
  deps: HotReloadDeps,
  options: BunServeOptions,
  restart?: RestartServer
): void {
  serveState(deps, options, restart);
  deps.log.info("pages:hot-reload", hotReloadOf(deps.state));
}

/**
 * Restarts the bin's server with the next options. A failure is logged, the old state is
 * published again and the old options are served again (A1); a failure of that is logged too.
 *
 * @param deps - Hub, state and log.
 * @param restart - The bin's restart.
 * @param previous - The options the server ran with.
 * @param next - The options with HMR switched.
 */
async function restartServer(
  deps: HotReloadDeps,
  restart: RestartServer,
  previous: BunServeOptions,
  next: BunServeOptions
): Promise<void> {
  try {
    await restart(next);
    deps.log.info("pages:hot-reload-switched", { hmr: hmrOf(next.development) });
    return;
  } catch (error) {
    deps.log.error("pages:hot-reload-restart-failed", {
      hmr: hmrOf(next.development),
      message: messageOf(error)
    });
  }

  // Back to the old options: the state first, then the server.
  serveState(deps, previous, restart);
  try {
    await restart(previous);
  } catch (error) {
    deps.log.error("pages:hot-reload-serve-again-failed", {
      hmr: hmrOf(previous.development),
      message: messageOf(error)
    });
  }
}

/**
 * Asks for HMR on or off. The bin with a restart switches: the asked state is set and published
 * at once, and the server restarts on the next macrotask, after the answer went out (A1). A
 * game's own server answers false; the bin answers true when its HMR already equals `on`, and a
 * bin attached without a restart refuses a change (logged at info). The state is published in
 * every case.
 *
 * @param deps - Hub, state and log.
 * @param on - The asked value.
 * @returns True when the bin owns the server and its HMR equals `on` or is switching to it; false
 * otherwise.
 */
export function setHotReload(deps: HotReloadDeps, on: boolean): Promise<boolean> {
  const { served, hot } = deps.state;
  if (served === undefined || hot.hmr === on) {
    publishState(deps);
    return Promise.resolve(served !== undefined);
  }

  const { restart, options } = served;
  if (restart === undefined) {
    deps.log.info("pages:hot-reload-read-only", { hmr: hot.hmr });
    publishState(deps);
    return Promise.resolve(false);
  }

  const next = withHmr(options, on);
  serveState(deps, next, restart);
  setTimeout(() => {
    void restartServer(deps, restart, options, next);
  }, 0);
  return Promise.resolve(true);
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
 * with the state: the asked one for a switch the bin makes (its server restarts after this
 * answer). A refused change (a game's own server) also answers 200: the caller compares the state
 * with the asked value, and the page logs no error.
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
