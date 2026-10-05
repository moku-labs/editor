/**
 * @file hub plugin — the `{path}/ws` route: path, started, upgrade header, Host and Origin, token,
 * kind and role are checked in that order before Bun upgrades the request. `role=page` with
 * `kind=tools` marks the editor page (A11). Every refusal is logged once, without the URL and
 * without the token.
 */
import type { ConnKind, HubCtx, HubServer, HubSocketData } from "../types";
import { refusalOf, refuse } from "./guard";
import { sameToken } from "./token";

/**
 * The status and the one-word body of each refusal, by the check that failed.
 */
const REFUSALS = {
  path: [404, "missing"],
  started: [503, "unavailable"],
  upgrade: [426, "upgrade"],
  port: [403, "forbidden"],
  host: [403, "forbidden"],
  origin: [403, "forbidden"],
  "fetch-site": [403, "forbidden"],
  token: [401, "unauthorized"],
  kind: [400, "invalid"],
  role: [400, "invalid"],
  failed: [400, "invalid"]
} satisfies Record<string, readonly [number, string]>;

/**
 * A check of the upgrade route.
 */
type UpgradeCheck = keyof typeof REFUSALS;

/**
 * The connection kind of the query, or undefined.
 *
 * @param value - The `kind` query value.
 * @returns "agent", "tools" or undefined.
 * @example
 * ```ts
 * kindOf("tools"); // "tools"
 * ```
 */
function kindOf(value: string | null): ConnKind | undefined {
  return value === "agent" || value === "tools" ? value : undefined;
}

/**
 * The `role` query value of the editor page.
 */
const PAGE_ROLE = "page";

/**
 * Whether an upgrade is the editor page (A11): no `role` is a plain connection, `role=page` with
 * `kind=tools` is the page, and anything else is refused.
 *
 * @param role - The `role` query value, null when absent.
 * @param kind - The connection kind.
 * @returns true for the page, false for a plain connection, undefined to refuse.
 * @example
 * ```ts
 * pageOf("page", "tools"); // true
 * pageOf("page", "agent"); // undefined
 * ```
 */
function pageOf(role: string | null, kind: ConnKind): boolean | undefined {
  if (role === null) return false;

  return role === PAGE_ROLE && kind === "tools" ? true : undefined;
}

/**
 * Logs and builds the refusal of a failed check (never the URL, never the token).
 *
 * @param ctx - Domain context of the hub.
 * @param req - The request.
 * @param check - The failed check.
 * @returns The refusal response.
 */
function refused(ctx: HubCtx, req: Request, check: UpgradeCheck): Response {
  const [status, word] = REFUSALS[check];
  ctx.log.warn("hub:refused", {
    status,
    check,
    host: req.headers.get("host") ?? undefined,
    origin: req.headers.get("origin") ?? undefined
  });

  return refuse(status, word);
}

/**
 * The first failing check before the token, or undefined.
 *
 * @param ctx - Domain context of the hub.
 * @param req - The request.
 * @param server - The Bun server.
 * @param url - The parsed request URL.
 * @returns The failing check, or undefined.
 */
function precheck(
  ctx: HubCtx,
  req: Request,
  server: HubServer,
  url: URL
): UpgradeCheck | undefined {
  if (url.pathname !== `${ctx.config.path}/ws`) return "path";
  if (ctx.state.token === undefined) return "started";
  if (req.method !== "GET" || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return "upgrade";
  }

  return refusalOf(req, server, "upgrade", ctx.state.origins);
}

/**
 * The `{path}/ws` handler: undefined after a successful upgrade (Bun contract), else a refusal
 * (404 path, 503 not started, 426 not an upgrade, 403 Host/Origin, 401 token, 400 kind, role or a
 * failed upgrade). An accepted upgrade keeps the server port for the editor page URL.
 *
 * @param ctx - Domain context of the hub.
 * @param req - The request.
 * @param server - The Bun server.
 * @returns undefined when upgraded, else the refusal.
 */
export function handleUpgrade(ctx: HubCtx, req: Request, server: HubServer): Response | undefined {
  // A request without Host (HTTP/1.0) carries a relative URL; the base only parses it, the guard
  // refuses the missing Host.
  const url = new URL(req.url, "http://127.0.0.1");
  const failed = precheck(ctx, req, server, url);
  if (failed !== undefined) return refused(ctx, req, failed);

  const { state } = ctx;
  if (!sameToken(url.searchParams.get("token") ?? "", state.token ?? "")) {
    return refused(ctx, req, "token");
  }

  const kind = kindOf(url.searchParams.get("kind"));
  if (kind === undefined) return refused(ctx, req, "kind");

  const page = pageOf(url.searchParams.get("role"), kind);
  if (page === undefined) return refused(ctx, req, "role");

  const conn = state.nextConn;
  state.nextConn += 1;
  state.editorPort = server.port;

  const data: HubSocketData = page ? { kind, conn, page } : { kind, conn };
  return server.upgrade(req, { data }) ? undefined : refused(ctx, req, "failed");
}
