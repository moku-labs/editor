/**
 * @file bridge plugin — the hello route: resolve its URL, the Origin a Bun process sends, fetch
 * `HelloBody { ws, token }` (R1) and build the socket URL `{path}/ws?token=…&kind=agent`. Failures
 * carry the status reason in their message, after the `[moku-editor] ` prefix.
 */
import type { HelloBody } from "../../registry/protocol";
import type { BridgeNet } from "../types";

/**
 * The init of the hello fetch.
 */
type HelloInit = Parameters<BridgeNet["fetch"]>[1];

/**
 * The status reason of a hello body without ws and token.
 */
const NO_BODY = "hello answered without ws and token";

/**
 * Builds the error of a failed hello; its message is the status reason after the prefix.
 *
 * @param reason - The status reason, e.g. "hello 404".
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw helloError("hello unreachable");
 * ```
 */
function helloError(reason: string): Error {
  return new Error(`[moku-editor] ${reason}`);
}

/**
 * True for a non-empty string.
 *
 * @param value - Anything.
 * @returns Whether `value` is a string with at least one character.
 * @example
 * ```ts
 * isFilled("t1"); // true
 * ```
 */
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Reads a hello body: `{ ws, token }` with two non-empty strings, nothing else kept.
 *
 * @param body - The parsed JSON of the hello answer.
 * @returns The HelloBody, or undefined when the shape is wrong.
 * @example
 * ```ts
 * helloBodyOf({ ws: "/__editor/ws", token: "t1" }); // { ws: "/__editor/ws", token: "t1" }
 * ```
 */
function helloBodyOf(body: unknown): HelloBody | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  if (!("ws" in body) || !("token" in body)) return undefined;
  const { ws, token } = body;
  return isFilled(ws) && isFilled(token) ? { ws, token } : undefined;
}

/**
 * Resolves the hello route against the page URL: `new URL(hello, href)`.
 *
 * @param hello - config.hello: a same-origin path or an absolute URL.
 * @param href - The page URL, undefined outside a browser.
 * @returns The hello URL, or undefined for a relative path without a page URL.
 * @example
 * ```ts
 * resolveHelloUrl("/__editor/hello", "http://127.0.0.1:3000/game.html")?.href; // "http://127.0.0.1:3000/__editor/hello"
 * ```
 */
export function resolveHelloUrl(hello: string, href: string | undefined): URL | undefined {
  try {
    return new URL(hello, href);
  } catch {
    return undefined;
  }
}

/**
 * The Origin the agent sends itself: the hello origin in a Bun process, undefined in a browser,
 * which sets Origin itself (R6: the hub always requires one). The runtime is told by the `Bun`
 * global, not by `document`: a Bun test page has a happy-dom `document` (like link's
 * `socketOrigin`).
 *
 * @param helloUrl - The hello URL.
 * @param scope - Where to look for the `Bun` global.
 * @param scope.Bun - The Bun namespace, present only in a Bun process.
 * @returns The hello origin under Bun, or undefined in a browser.
 * @example
 * ```ts
 * helloOrigin(new URL("http://127.0.0.1:3000/__editor/hello")); // "http://127.0.0.1:3000" under Bun
 * ```
 */
export function helloOrigin(
  helloUrl: URL,
  scope: { readonly Bun?: object } = globalThis
): string | undefined {
  return scope.Bun === undefined ? undefined : helloUrl.origin;
}

/**
 * Fetches the hello route without cache, same-origin, and checks the body.
 *
 * @param net - The network seam.
 * @param url - The hello URL.
 * @param headers - Extra headers (the Origin outside a browser), or undefined.
 * @returns The HelloBody `{ ws, token }`.
 * @throws {Error} `[moku-editor] hello unreachable`, `[moku-editor] hello <status>` or
 *   `[moku-editor] hello answered without ws and token`.
 */
export async function fetchHello(
  net: BridgeNet,
  url: URL,
  headers: Record<string, string> | undefined
): Promise<HelloBody> {
  const init: HelloInit =
    headers === undefined
      ? { cache: "no-store", credentials: "same-origin" }
      : { cache: "no-store", credentials: "same-origin", headers };

  const response = await net.fetch(url.href, init).catch(() => {
    throw helloError("hello unreachable");
  });
  if (!response.ok) throw helloError(`hello ${String(response.status)}`);

  const body = await response.json().catch(() => {
    throw helloError(NO_BODY);
  });
  const hello = helloBodyOf(body);
  if (hello === undefined) throw helloError(NO_BODY);
  return hello;
}

/**
 * Builds the socket URL: `ws` resolved against the hello URL, http → ws, https → wss, then
 * `token` and `kind=agent` set on the query (R1).
 *
 * @param helloUrl - The hello URL.
 * @param body - The hello body.
 * @returns The websocket URL.
 * @throws {Error} When `ws` is not a URL, or not an http(s)/ws(s) one.
 * @example
 * ```ts
 * socketUrl(new URL("http://127.0.0.1:3000/__editor/hello"), { ws: "/__editor/ws", token: "t1" }).href;
 * // "ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent"
 * ```
 */
export function socketUrl(helloUrl: URL, body: HelloBody): URL {
  const url = new URL(body.ws, helloUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`[moku-editor] ${url.protocol} is not a websocket URL`);
  }
  url.searchParams.set("token", body.token);
  url.searchParams.set("kind", "agent");
  return url;
}
