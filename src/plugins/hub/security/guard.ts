/**
 * @file hub plugin — the shared request check (R3): exact Host and Origin allowlists against DNS
 * rebinding, and Sec-Fetch-Site for same-origin routes. Pure: no state, no log.
 */
import type { GuardCheck, GuardMode, HubServer } from "../types";

/**
 * The hosts the editor answers to.
 */
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost"];

/**
 * The Sec-Fetch-Site values a same-origin route accepts.
 */
const SAME_ORIGIN_SITES: ReadonlySet<string> = new Set(["same-origin", "none"]);

/**
 * The Host values allowed on a port, lowercased: `127.0.0.1:<port>` and `localhost:<port>`, plus
 * the bare names on port 80.
 *
 * @param port - The server port.
 * @returns The allowed Host header values.
 * @example
 * ```ts
 * allowedHosts(3000); // Set { "127.0.0.1:3000", "localhost:3000" }
 * ```
 */
export function allowedHosts(port: number): ReadonlySet<string> {
  const hosts = new Set(LOOPBACK_HOSTS.map(host => `${host}:${port}`));
  if (port === 80) for (const host of LOOPBACK_HOSTS) hosts.add(host);

  return hosts;
}

/**
 * The Origin values allowed on a port: the http origins of the loopback hosts (port-less forms
 * too on port 80) plus the configured extra origins.
 *
 * @param port - The server port.
 * @param allow - Extra origins (normalized config.allowOrigins).
 * @returns The allowed Origin header values.
 * @example
 * ```ts
 * allowedOrigins(3000, new Set()); // Set { "http://127.0.0.1:3000", "http://localhost:3000" }
 * ```
 */
export function allowedOrigins(port: number, allow: ReadonlySet<string>): ReadonlySet<string> {
  const origins = new Set([...allowedHosts(port)].map(host => `http://${host}`));
  for (const origin of allow) origins.add(origin);

  return origins;
}

/**
 * The check that refuses a request, or undefined when every check passes. The string `null`
 * never matches an origin.
 *
 * @param req - The request.
 * @param server - The Bun server (its port).
 * @param mode - Which rules apply.
 * @param allow - Extra origins (normalized config.allowOrigins).
 * @returns The failing check, or undefined.
 * @example
 * ```ts
 * const headers = { host: "127.0.0.1:3000", origin: "http://evil.com" };
 * const req = new Request("http://127.0.0.1:3000/__editor/ws", { headers });
 * refusalOf(req, { port: 3000, upgrade: () => false }, "upgrade", new Set()); // "origin"
 * ```
 */
export function refusalOf(
  req: Request,
  server: HubServer,
  mode: GuardMode,
  allow: ReadonlySet<string>
): GuardCheck | undefined {
  const { port } = server;
  if (port === undefined) return "port";

  const host = req.headers.get("host")?.toLowerCase();
  if (host === undefined || !allowedHosts(port).has(host)) return "host";

  const origin = req.headers.get("origin")?.toLowerCase();
  if (isOriginRefused(origin, mode, port, allow)) return "origin";

  const site = req.headers.get("sec-fetch-site");
  if (mode === "same-origin" && site !== null && !SAME_ORIGIN_SITES.has(site.toLowerCase())) {
    return "fetch-site";
  }

  return undefined;
}

/**
 * True for an origin in the allowlist; `null` never is.
 *
 * @param origin - The lowercased Origin header.
 * @param port - The server port.
 * @param allow - Extra origins.
 * @returns Whether the origin may call.
 * @example
 * ```ts
 * isAllowedOrigin("http://localhost:3000", 3000, new Set()); // true
 * ```
 */
function isAllowedOrigin(origin: string, port: number, allow: ReadonlySet<string>): boolean {
  return origin !== "null" && allowedOrigins(port, allow).has(origin);
}

/**
 * True when the Origin check refuses: a missing Origin is refused only on upgrade, a present one
 * must be in the allowlist.
 *
 * @param origin - The lowercased Origin header, or undefined when absent.
 * @param mode - Which rules apply.
 * @param port - The server port.
 * @param allow - Extra origins.
 * @returns Whether the origin check fails.
 * @example
 * ```ts
 * isOriginRefused(undefined, "navigate", 3000, new Set()); // false
 * isOriginRefused("http://evil.com", "navigate", 3000, new Set()); // true
 * ```
 */
function isOriginRefused(
  origin: string | undefined,
  mode: GuardMode,
  port: number,
  allow: ReadonlySet<string>
): boolean {
  if (origin === undefined) return mode === "upgrade";

  return !isAllowedOrigin(origin, port, allow);
}

/**
 * A refusal: plain text, never cached, a one-word body.
 *
 * @param status - HTTP status.
 * @param word - The body.
 * @returns The response.
 * @example
 * ```ts
 * return refuse(403, "forbidden");
 * ```
 */
export function refuse(status: number, word: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  };
  if (status === 426) headers.upgrade = "websocket";

  return new Response(word, { status, headers });
}

/**
 * The shared request check (R3): `undefined` when allowed, else a 403 refusal.
 *
 * | Mode | Host | Origin | Sec-Fetch-Site |
 * |---|---|---|---|
 * | upgrade | allowed | required, allowed | ignored |
 * | same-origin | allowed | allowed when present | same-origin or none when present |
 * | navigate | allowed | allowed when present | ignored |
 *
 * @param req - The request.
 * @param server - The Bun server (its port).
 * @param mode - Which rules apply.
 * @param allow - Extra origins (normalized config.allowOrigins).
 * @returns A 403 response, or undefined.
 * @example
 * ```ts
 * const headers = { host: "127.0.0.1:3000", origin: "http://evil.com" };
 * const req = new Request("http://127.0.0.1:3000/__editor/ws", { headers });
 * guard(req, { port: 3000, upgrade: () => false }, "upgrade", new Set())?.status; // 403
 * ```
 */
export function guard(
  req: Request,
  server: HubServer,
  mode: GuardMode,
  allow: ReadonlySet<string>
): Response | undefined {
  return refusalOf(req, server, mode, allow) === undefined ? undefined : refuse(403, "forbidden");
}
