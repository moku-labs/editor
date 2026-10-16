/**
 * @file connect plugin — CDP attach over adb (spec 11 C5): forward a local port to the WebView's
 * devtools socket (A9), list its targets, connect to the page target whose URL is the device
 * session's page without the hash, and detach (close the socket, remove the forward, A10). Every
 * step checks whether the attach ended meanwhile, so a lease that ended while `/json/list` was
 * answering leaves no forward open. The socket never leaves this computer's loopback: a debugger
 * URL off the forward's port is never dialled.
 */
import type { AttachRecord, ConnectCore } from "../types";
import { parseForward } from "../wire/parse";
import { adb } from "../wire/run";
import { connectCdp } from "./client";

/**
 * A URL without its hash.
 *
 * @param url - The URL.
 * @returns The part before "#".
 * @example
 * ```ts
 * withoutHash("http://tauri.localhost/#/play"); // "http://tauri.localhost/"
 * ```
 */
function withoutHash(url: string): string {
  return url.split("#", 1)[0] ?? url;
}

/**
 * Fetches a JSON document with a timeout (the runtime seam of `/json/list`).
 *
 * @param url - The URL.
 * @param timeoutMs - The longest wait.
 * @returns The parsed JSON (unknown shape: the caller narrows it).
 * @throws {Error} On a network error, the timeout or a status other than 2xx.
 */
export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(
      `[moku-editor] connect: ${url} answered ${response.status}.\n  The WebView lists no pages.`
    );
  }
  return response.json();
}

/**
 * Whether a debugger URL is on this computer's loopback, at the forward's port.
 *
 * @param value - The `webSocketDebuggerUrl`.
 * @param port - The forward's local port.
 * @returns True for a loopback URL of that port.
 * @example
 * ```ts
 * isLocalDebugger("ws://127.0.0.1:40211/devtools/page/7", 40211); // true
 * ```
 */
function isLocalDebugger(value: unknown, port: number): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith(`ws://127.0.0.1:${port}/`) || value.startsWith(`ws://localhost:${port}/`))
  );
}

/**
 * The debugger URL of the page target whose URL, without the hash, is the session's page.
 *
 * @param list - What `/json/list` answered.
 * @param page - The device session's page.
 * @param port - The forward's local port.
 * @returns The `webSocketDebuggerUrl`, or undefined when no page target matches.
 * @example
 * ```ts
 * pickTarget([{ type: "page", url: "http://tauri.localhost/#/menu", webSocketDebuggerUrl: "ws://127.0.0.1:40211/devtools/page/7" }], "http://tauri.localhost/#/play", 40211); // "ws://127.0.0.1:40211/devtools/page/7"
 * ```
 */
export function pickTarget(list: unknown, page: string, port: number): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const wanted = withoutHash(page);
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const type = "type" in item ? item.type : undefined;
    const url = "url" in item ? item.url : undefined;
    const debuggerUrl = "webSocketDebuggerUrl" in item ? item.webSocketDebuggerUrl : undefined;
    if (type !== "page" || typeof url !== "string" || withoutHash(url) !== wanted) continue;
    if (isLocalDebugger(debuggerUrl, port)) return debuggerUrl;
  }
  return undefined;
}

/**
 * Removes a forward connect recorded (A10) and forgets it at once.
 *
 * @param ctx - The config and the state.
 * @param port - The forward's local port.
 * @returns When adb answered.
 */
export async function removeForward(ctx: ConnectCore, port: number): Promise<void> {
  const serial = ctx.state.forwards.get(port);
  if (serial === undefined) return;
  const removed = adb(ctx, { kind: "forward-remove", serial, port });
  ctx.state.forwards.delete(port);
  try {
    await removed;
  } catch {
    // A recorded port is never refused; adb itself never rejects.
  }
}

/**
 * Forwards a local port to a devtools socket of a phone (A9) and records it.
 *
 * @param ctx - The config and the state.
 * @param serial - The phone.
 * @param socket - The devtools socket.
 * @returns The local port, or undefined when adb printed none.
 */
async function forwardTo(
  ctx: ConnectCore,
  serial: string,
  socket: string
): Promise<number | undefined> {
  const result = await adb(ctx, { kind: "forward", serial, socket });
  const port = result.code === 0 ? parseForward(result.text) : undefined;
  if (port !== undefined) ctx.state.forwards.set(port, serial);
  return port;
}

/**
 * Tries one devtools socket: forward, list, connect. Gives the forward back on every way out but
 * a connection.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach (its serial, page and `ended`).
 * @param socket - The devtools socket.
 * @param onLost - Called when the CDP socket closes by itself later.
 * @returns True when the attach has its CDP link.
 */
async function tryAttach(
  ctx: ConnectCore,
  attach: AttachRecord,
  socket: string,
  onLost: (() => void) | undefined
): Promise<boolean> {
  const port = await forwardTo(ctx, attach.serial, socket);
  if (port === undefined) {
    attach.heap.off = "error";
    return false;
  }
  try {
    const list = attach.ended
      ? undefined
      : await ctx.state.deps.fetchJson(
          `http://127.0.0.1:${port}/json/list`,
          ctx.config.adbTimeoutMs
        );
    const url = attach.ended ? undefined : pickTarget(list, attach.page ?? "", port);
    if (url === undefined) {
      await removeForward(ctx, port);
      return false;
    }
    const client = await connectCdp(ctx.state.deps.openSocket, url, {
      gcTrace: ctx.config.gcTrace,
      timeoutMs: ctx.config.adbTimeoutMs,
      onClose: () => {
        if (attach.cdp?.port === port) onLost?.();
      }
    });
    if (attach.ended) {
      client.close();
      await removeForward(ctx, port);
      return false;
    }
    attach.cdp = { client, port, socket };
    return true;
  } catch {
    attach.heap.off = "error";
    await removeForward(ctx, port);
    return false;
  }
}

/**
 * Attaches CDP to the phone's WebView page: tries each devtools socket in order until one lists
 * the session's page. Sets `attach.heap.off` when none does: "no-devtools-socket" without a socket
 * (the build did not enable WebView debugging), "no-target" when no page matches, "error" when adb
 * or the socket failed.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @param sockets - The devtools sockets to try, the app's first.
 * @param onLost - Called when the CDP socket closes by itself later (the app restarted).
 * @returns The socket attached, or undefined.
 */
export async function attachCdp(
  ctx: ConnectCore,
  attach: AttachRecord,
  sockets: readonly string[],
  onLost?: () => void
): Promise<string | undefined> {
  if (sockets.length === 0) {
    attach.heap.off = "no-devtools-socket";
    return undefined;
  }
  attach.heap.off = "no-target";
  if (attach.page === null) return undefined;

  for (const socket of sockets) {
    if (attach.ended) return undefined;
    if (await tryAttach(ctx, attach, socket, onLost)) return socket;
  }
  return undefined;
}

/**
 * Detaches CDP: forgets the link, closes its socket and removes its forward.
 *
 * @param ctx - The config and the state.
 * @param attach - The attach.
 * @returns When adb removed the forward.
 */
export async function detachCdp(ctx: ConnectCore, attach: AttachRecord): Promise<void> {
  const link = attach.cdp;
  if (link === undefined) return;
  attach.cdp = undefined;
  link.client.close();
  await removeForward(ctx, link.port);
}
