/**
 * @file pages plugin — the five editor routes under `P = hub.path()`: `P` (308 to `P/`), `P/`
 * (the tools page with the boot JSON and the CSP), `P/hello` (`{ ws, token }`, same-origin only),
 * `P/hmr` (hot reload, hot-reload.ts) and `P/assets/*` (the built files). Every handler runs
 * hub.guard first; all but `P/hmr` answer GET and HEAD only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path/posix";
import type { EditorRoutes, GuardMode, HubServer, RouteHandler } from "../hub/types";
import type { HelloBody, ToolsBoot } from "../registry/protocol";
import { buildBoot, injectBoot, wsUrlOf } from "./boot";
import { hotReloadRoute } from "./hot-reload";
import {
  badRequest,
  decodePath,
  isRead,
  methodNotAllowed,
  notFound,
  readRegularFile,
  respond,
  textResponse
} from "./http";
import { contentType } from "./mime";
import type { RouteDeps } from "./types";

/**
 * The Content-Security-Policy of the tools page: the R3 policy verbatim, then the three private
 * hardening directives (R7). Fonts load under `default-src 'self'`.
 */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; " +
  "style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; " +
  "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * The value of `X-Content-Type-Options` on every answer.
 */
const NOSNIFF = "nosniff";

/**
 * Headers of the tools page. The token rotates per start, so the page is never cached.
 */
const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": NOSNIFF,
  "content-security-policy": PAGE_CSP
};

/**
 * Headers of the hello answer. No CORS header, ever.
 */
const HELLO_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": NOSNIFF
};

/**
 * The cache rule of the built assets: their names are hashed.
 */
const ASSET_CACHE = "public, max-age=31536000, immutable";

/**
 * The body of the 503 when no built page exists.
 */
const NOT_BUILT = "tools page not built · run bun run build:tools";

/**
 * The body of the 503 before start and after stop (the hub has no token).
 */
const NOT_STARTED = "editor not started · call await editor.start()";

/**
 * A relative asset name: segments of letters, digits, `.`, `_` and `-`.
 */
const ASSET_NAME = /^[\w.-]+(?:\/[\w.-]+)*$/;

/**
 * A page handler body: the request already passed the guard and is a GET or HEAD.
 */
type Answer = (req: Request) => Response | Promise<Response>;

/**
 * Wraps an answer with the guard and the method check.
 *
 * @param deps - Route deps (hub.guard).
 * @param mode - Guard mode of the route.
 * @param answer - The GET/HEAD answer.
 * @returns The route handler.
 */
function guarded(deps: RouteDeps, mode: GuardMode, answer: Answer): RouteHandler {
  return function route(req: Request, server: HubServer): Response | Promise<Response> {
    const refused = deps.hub.guard(req, server, mode);
    if (refused) return refused;

    return isRead(req) ? answer(req) : methodNotAllowed(req);
  };
}

/**
 * The `P` answer: 308 to `P/`, query kept (the page needs the slash for its `./assets/` URLs).
 *
 * @param path - hub.path().
 * @returns The answer.
 * @example
 * ```ts
 * const answer = redirectTo("/__editor");
 * answer(new Request("http://127.0.0.1:3000/__editor?x=1")); // 308, location "/__editor/?x=1"
 * ```
 */
function redirectTo(path: string): Answer {
  return function redirect(req: Request): Response {
    const { search } = new URL(req.url);
    return textResponse(req, 308, "moved", { location: `${path}/${search}` });
  };
}

/**
 * The template of the built page, read once and cached in state.
 *
 * @param deps - Route deps (state).
 * @returns The template, or undefined when the page is not built.
 */
async function loadTemplate(deps: RouteDeps): Promise<string | undefined> {
  const { state } = deps;
  if (state.template !== undefined || state.pageDir === undefined) return state.template;

  try {
    state.template = await readFile(join(state.pageDir, "index.html"), "utf8");
  } catch {
    return undefined;
  }
  return state.template;
}

/**
 * The boot JSON, or undefined when the hub has no token (before start, after stop).
 *
 * @param req - The request.
 * @param deps - Route deps.
 * @returns The boot, or undefined.
 */
function bootOrUndefined(req: Request, deps: RouteDeps): ToolsBoot | undefined {
  try {
    return buildBoot(req, deps);
  } catch {
    return undefined;
  }
}

/**
 * The `P/` answer: the built page with the boot tag, the title and the security headers. A
 * missing page answers 503 and logs `pages:not-built` once per app.
 *
 * @param deps - Route deps.
 * @returns The answer.
 */
function pageAnswer(deps: RouteDeps): Answer {
  let reported = false;

  return async function page(req: Request): Promise<Response> {
    const template = await loadTemplate(deps);
    if (template === undefined) {
      if (!reported) deps.log.error("pages:not-built", { pageDir: deps.state.pageDir });
      reported = true;
      return textResponse(req, 503, NOT_BUILT);
    }

    const boot = bootOrUndefined(req, deps);
    if (boot === undefined) return textResponse(req, 503, NOT_STARTED);

    const html = injectBoot(template, boot, deps.config.title);
    if (html === undefined)
      return textResponse(req, 503, `${NOT_BUILT} (index.html has no </head>)`);

    return respond(req, html, 200, PAGE_HEADERS);
  };
}

/**
 * The `P/hello` answer: `{ ws, token }` for the game page's bridge (same origin only, by guard).
 *
 * @param deps - Route deps.
 * @returns The answer.
 */
function helloAnswer(deps: RouteDeps): Answer {
  return function hello(req: Request): Response {
    const boot = bootOrUndefined(req, deps);
    if (boot === undefined) return textResponse(req, 503, NOT_STARTED);

    const body: HelloBody = { ws: wsUrlOf(req, boot.path), token: boot.token };
    return respond(req, JSON.stringify(body), 200, HELLO_HEADERS);
  };
}

/**
 * True for a safe relative asset name: allowed characters, no segment starting with `.` (which
 * also refuses `.` and `..`).
 *
 * @param name - The decoded name.
 * @returns Whether the name may be served.
 * @example
 * ```ts
 * isAssetName("index-3f7a.js"); // true
 * ```
 */
function isAssetName(name: string): boolean {
  return ASSET_NAME.test(name) && name.split("/").every(segment => !segment.startsWith("."));
}

/**
 * The `P/assets/*` answer: a regular file of `pageDir/assets/`, else 404 (400 for a malformed
 * escape).
 *
 * @param deps - Route deps.
 * @param path - hub.path().
 * @returns The answer.
 */
function assetAnswer(deps: RouteDeps, path: string): Answer {
  const prefix = `${path}/assets/`;

  return async function asset(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const { pageDir } = deps.state;
    if (!pathname.startsWith(prefix) || pageDir === undefined) return notFound(req);

    const name = decodePath(pathname.slice(prefix.length));
    if (name === undefined) return badRequest(req);
    if (!isAssetName(name)) return notFound(req);

    const body = await readRegularFile(join(pageDir, "assets", name));
    if (body === undefined) return notFound(req);

    return respond(req, body, 200, {
      "content-type": contentType(name),
      "cache-control": ASSET_CACHE,
      "x-content-type-options": NOSNIFF
    });
  };
}

/**
 * Creates the editor routes of pages (frozen), keyed under hub.path().
 *
 * @param deps - Hub, files, config, state and log.
 * @returns The five routes, in the order `P`, `P/`, `P/hello`, `P/hmr`, `P/assets/*`.
 */
export function createRoutes(deps: RouteDeps): EditorRoutes {
  const path = deps.hub.path();

  return Object.freeze({
    [path]: guarded(deps, "navigate", redirectTo(path)),
    [`${path}/`]: guarded(deps, "navigate", pageAnswer(deps)),
    [`${path}/hello`]: guarded(deps, "same-origin", helloAnswer(deps)),
    [`${path}/hmr`]: hotReloadRoute(deps),
    [`${path}/assets/*`]: guarded(deps, "navigate", assetAnswer(deps, path))
  });
}
