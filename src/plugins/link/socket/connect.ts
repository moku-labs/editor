/**
 * @file link plugin — the tools socket: boot → upgrade URL (R1) with the Origin header outside a
 * browser (R8), open, close, the reconnect backoff with the hello refresh, and `retry()`.
 */
import { pageHref, readBoot, refreshBoot } from "../boot/read";
import { failAll, linkClosedError } from "../rpc/calls";
import { retrySession } from "../sessions/choose";
import { clearRetry } from "../state";
import { applyStatus } from "../status/machine";
import { detachAll } from "../subscriptions/watch";
import type { LinkCtx } from "../types";
import { backoffDelay } from "./backoff";
import { onSocketMessage } from "./messages";

/**
 * The http scheme of each websocket scheme (the hub serves the page and the socket on one origin).
 */
const HTTP_SCHEME: Readonly<Record<string, string>> = { "ws:": "http:", "wss:": "https:" };

/**
 * The status reason of a socket loss.
 */
const SOCKET_CLOSED = "socket_closed";

/**
 * Creates the websocket. With an origin it uses Bun's client option `{ headers: { origin } }`
 * (outside a browser the hub needs an Origin, R8); a browser would read that object as a
 * sub-protocol and throw, so without an origin the URL is the only argument.
 *
 * @param url - The upgrade URL with its query.
 * @param origin - Origin header value, undefined in a browser.
 * @returns The socket.
 * @example
 * ```ts
 * const socket = createSocket(`${boot.ws}?token=${token}&kind=tools`, undefined);
 * ```
 */
export function createSocket(url: string, origin: string | undefined): WebSocket {
  if (origin === undefined) return new WebSocket(url);
  // The DOM typing of the WebSocket constructor does not know Bun's options object.
  return Reflect.construct(WebSocket, [url, { headers: { origin } }]);
}

/**
 * The page origin of the socket: `boot.ws` resolved against the page, ws → http, wss → https.
 *
 * @param ws - The socket URL from the boot (no query).
 * @param base - The page URL it is resolved against.
 * @returns `scheme://host[:port]`.
 * @example
 * ```ts
 * bootOrigin("ws://127.0.0.1:3000/__editor/ws", location.href); // "http://127.0.0.1:3000"
 * ```
 */
export function bootOrigin(ws: string, base: string): string {
  const url = new URL(ws, base);
  return `${HTTP_SCHEME[url.protocol] ?? url.protocol}//${url.host}`;
}

/**
 * The Origin header of the socket: the boot page origin outside a browser (a Bun process, R8),
 * undefined in a browser, which sets Origin itself. The tests have a happy-dom `document`, so the
 * runtime is told by the `Bun` global, not by `document`.
 *
 * @param ws - The socket URL from the boot.
 * @param scope - Where to look for the `Bun` global.
 * @param scope.Bun - The Bun namespace, present only in a Bun process.
 * @returns The origin, or undefined in a browser.
 * @example
 * ```ts
 * socketOrigin("ws://127.0.0.1:3000/__editor/ws", { Bun: {} }); // "http://127.0.0.1:3000"
 * socketOrigin("ws://127.0.0.1:3000/__editor/ws", {}); // undefined (a browser)
 * ```
 */
export function socketOrigin(
  ws: string,
  scope: { readonly Bun?: object } = globalThis
): string | undefined {
  return scope.Bun === undefined ? undefined : bootOrigin(ws, pageHref() ?? ws);
}

/**
 * Marks the link lost after a failed connect and schedules the next one.
 *
 * @param ctx - Domain context of link.
 * @param refresh - Whether the next attempt fetches hello first.
 */
function connectFailed(ctx: LinkCtx, refresh: boolean): void {
  const { state, config } = ctx;
  const retryInMs = backoffDelay(state.attempt - 1, config.retryMs);

  applyStatus(ctx, { type: "socket-closed", reason: SOCKET_CLOSED, retryInMs });
  scheduleReconnect(ctx, refresh);
}

/**
 * Opens the tools socket from the boot data and wires its listeners. Every listener returns early
 * once link stopped or once this socket is no longer the current one. The token is never logged.
 *
 * @param ctx - Domain context of link.
 */
export function openSocket(ctx: LinkCtx): void {
  const { state, log } = ctx;
  const { boot } = state;
  if (boot === undefined) return;

  const url = `${boot.ws}?token=${encodeURIComponent(boot.token)}&kind=tools`;
  log.info("link:connect", { ws: boot.ws });

  let socket: WebSocket;
  try {
    socket = createSocket(url, socketOrigin(boot.ws));
  } catch {
    log.error("link:socket-failed", { ws: boot.ws });
    state.attempt += 1;
    connectFailed(ctx, true);
    return;
  }
  state.socket = socket;

  /**
   * True while this socket is the current one and link has not stopped.
   *
   * @returns Whether an event of this socket still counts.
   */
  const current = (): boolean => !state.stopped && state.socket === socket;
  socket.addEventListener("open", () => {
    if (current()) onSocketOpen(ctx);
  });
  socket.addEventListener("message", event => {
    if (!current()) return;
    if (typeof event.data === "string") onSocketMessage(ctx, event.data);
    else log.warn("link:binary-message", {});
  });
  socket.addEventListener("close", event => {
    if (current()) onSocketClose(ctx, event);
  });
  socket.addEventListener("error", () => {
    if (current()) log.warn("link:socket-error", { ws: boot.ws });
  });
}

/**
 * The socket opened: the hub's first `sessions` notification drives the attach.
 *
 * @param ctx - Domain context of link.
 */
export function onSocketOpen(ctx: LinkCtx): void {
  const { state } = ctx;

  state.open = true;
  state.attempt = 0;
  applyStatus(ctx, { type: "socket-open" });
}

/**
 * The socket closed: pending calls fail `link_closed`, wire subs are dropped (records kept), the
 * session list is cleared (the chosen id stays as the preference), status lost, reconnect later.
 * A socket that never opened makes the reconnect refresh the token through hello first.
 *
 * @param ctx - Domain context of link.
 * @param event - The close event.
 * @param event.code - Close code.
 * @param event.reason - Close reason.
 */
export function onSocketClose(
  ctx: LinkCtx,
  event: { readonly code: number; readonly reason: string }
): void {
  const { state } = ctx;
  const wasOpen = state.open;

  state.open = false;
  state.socket = undefined;
  state.sessions = [];
  clearRetry(state);
  failAll(ctx, linkClosedError());
  detachAll(ctx);
  state.attempt = wasOpen ? 1 : state.attempt + 1;
  ctx.log.info("link:closed", { code: event.code, reason: event.reason });
  connectFailed(ctx, !wasOpen);
}

/**
 * Schedules the next connect after the backoff of the current attempt.
 *
 * @param ctx - Domain context of link.
 * @param refresh - Fetch hello for a fresh token before opening.
 */
export function scheduleReconnect(ctx: LinkCtx, refresh: boolean): void {
  const { state, config } = ctx;

  clearRetry(state);
  state.retryTimer = setTimeout(
    () => {
      state.retryTimer = undefined;
      reconnect(ctx, refresh);
    },
    backoffDelay(state.attempt - 1, config.retryMs)
  );
}

/**
 * Connects again, after a hello refresh when asked. A failed hello schedules the next attempt;
 * an answer that arrives after another socket was opened (or after stop) is dropped.
 *
 * @param ctx - Domain context of link.
 * @param refresh - Fetch hello first.
 */
export function reconnect(ctx: LinkCtx, refresh: boolean): void {
  const { state } = ctx;
  const { boot } = state;
  if (state.stopped || state.socket !== undefined || boot === undefined) return;

  if (!refresh) {
    openSocket(ctx);
    return;
  }
  refreshBoot(boot).then(fresh => {
    if (state.stopped || state.socket !== undefined) return;
    if (fresh === undefined) {
      ctx.log.warn("link:hello-failed", { path: boot.path });
      state.attempt += 1;
      connectFailed(ctx, true);
      return;
    }
    state.boot = fresh;
    openSocket(ctx);
  }, ignoreFailure);
}

/**
 * Ignores a rejection that was already handled where it happened.
 */
export function ignoreFailure(): void {
  // The failure was logged (or cannot happen: refreshBoot never rejects).
}

/**
 * Reads the boot tag when there is no boot yet, then opens the socket. Without a valid tag:
 * `link:no-boot` and status lost `no_boot` (no timer; `retry()` reads the tag again).
 *
 * @param ctx - Domain context of link.
 */
export function connect(ctx: LinkCtx): void {
  const { state, config } = ctx;

  state.boot ??= readBoot(config.boot, globalThis.document);
  if (state.boot === undefined) {
    ctx.log.error("link:no-boot", { selector: config.boot });
    applyStatus(ctx, { type: "no-boot" });
    return;
  }
  openSocket(ctx);
}

/**
 * "Retry now": re-reads the boot tag after `no_boot`, reconnects at once (with a hello refresh)
 * when the socket is closed, or re-picks a session when only the session was lost. No-op
 * otherwise.
 *
 * @param ctx - Domain context of link.
 */
export function retryNow(ctx: LinkCtx): void {
  const { state } = ctx;
  if (state.stopped || state.status.kind !== "lost") return;

  if (state.boot === undefined) {
    connect(ctx);
    return;
  }
  if (state.socket === undefined) {
    clearRetry(state);
    reconnect(ctx, true);
    return;
  }
  if (state.open && state.chosen === undefined) retrySession(ctx);
}
