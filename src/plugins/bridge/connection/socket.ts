/**
 * @file bridge plugin — the default network seam over the platform `fetch` and `WebSocket`
 * (browser, or Bun with its `headers` option outside a browser).
 */
import type { BridgeNet, SocketLike } from "../types";

/**
 * The websocket constructor the bridge calls: the browser form, or Bun's with an options object.
 */
type SocketConstructor = new (
  url: string,
  options?: { readonly headers: Readonly<Record<string, string>> }
) => SocketLike;

/**
 * True for a constructor (the platform WebSocket).
 *
 * @param value - The global `WebSocket`, read at run time.
 * @returns Whether it can be called with `new`.
 * @example
 * ```ts
 * isSocketConstructor(globalThis.WebSocket); // true in a browser and in Bun
 * ```
 */
function isSocketConstructor(value: unknown): value is SocketConstructor {
  return typeof value === "function";
}

/**
 * The WebSocket constructor of a scope.
 *
 * @param scope - The global scope.
 * @returns The constructor, or undefined in a runtime without WebSocket.
 */
function socketConstructorOf(scope: typeof globalThis): SocketConstructor | undefined {
  const candidate: unknown = Reflect.get(scope, "WebSocket");
  return isSocketConstructor(candidate) ? candidate : undefined;
}

/**
 * True when the scope has both `WebSocket` and `fetch` (connect step 2).
 *
 * @param scope - The global scope.
 * @returns Whether the bridge can connect in this runtime.
 */
export function hasNetwork(scope: typeof globalThis): boolean {
  return (
    socketConstructorOf(scope) !== undefined && typeof Reflect.get(scope, "fetch") === "function"
  );
}

/**
 * Opens a websocket with the scope's constructor.
 *
 * @param scope - The global scope.
 * @param url - The socket URL.
 * @param origin - The Origin header to send (outside a browser), or undefined.
 * @returns The socket.
 * @throws {Error} `[moku-editor] no WebSocket in this runtime`.
 * @example
 * ```ts
 * openSocketIn(globalThis, "ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent", "http://127.0.0.1:3000");
 * ```
 */
function openSocketIn(
  scope: typeof globalThis,
  url: string,
  origin: string | undefined
): SocketLike {
  const Socket = socketConstructorOf(scope);
  if (Socket === undefined) throw new Error("[moku-editor] no WebSocket in this runtime");
  return origin === undefined ? new Socket(url) : new Socket(url, { headers: { origin } });
}

/**
 * The network seam over a global scope: its fetch, its WebSocket and Math.random.
 *
 * @param scope - The global scope (`globalThis`).
 * @returns The BridgeNet. `openSocket(url, origin)` passes `{ headers: { origin } }` only when an
 *   origin is given: Bun reads it as client headers, a browser would read it as a sub-protocol.
 * @example
 * ```ts
 * const net = defaultNet(globalThis);
 * const socket = net.openSocket("ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent", undefined);
 * ```
 */
export function defaultNet(scope: typeof globalThis): BridgeNet {
  return {
    fetch: (url, init) => scope.fetch(url, init),
    openSocket: (url, origin) => openSocketIn(scope, url, origin),
    // eslint-disable-next-line sonarjs/pseudo-random -- backoff jitter only, nothing secret
    random: () => Math.random()
  };
}
