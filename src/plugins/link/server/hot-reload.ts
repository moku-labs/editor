/**
 * @file link plugin — hot reload of the game server (R6): the state the hub publishes as
 * `editor.hotReload`, its listeners, and the change request `POST {path}/hmr` with the boot token
 * as a Bearer. The state is a server fact shared by every tools tab, never stored in the page. The
 * bin restarts its server for a change (D-32), which can cut the answer off: the request then waits
 * for the reconnect to deliver the state (A1).
 */
import type { HotReload, Json, ToolsBoot } from "../../registry/protocol";
import { pageHref } from "../boot/read";
import { readHotReload } from "../rpc/shapes";
import type { HotReloadWaiter, LinkCtx, LinkState } from "../types";
import { HOT_RELOAD_CONFIRM_MS } from "../types";

/**
 * The answer of `{path}/hmr`: whether it was ok and the state its body carries.
 */
type HmrAnswer = { readonly ok: boolean; readonly state: HotReload | undefined };

/**
 * Stores a new state and gives it, frozen, to every listener in subscription order. The same
 * state again changes nothing. A listener that throws is logged and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param next - The state the hub sent or the route answered.
 */
export function applyHotReload(ctx: LinkCtx, next: HotReload): void {
  const { state } = ctx;
  const current = state.hotReload;
  if (current?.hmr === next.hmr && current.owner === next.owner) return;

  const frozen = Object.freeze({ hmr: next.hmr, owner: next.owner });
  state.hotReload = frozen;
  for (const listener of state.hotReloadListeners) {
    try {
      listener(frozen);
    } catch (error) {
      ctx.log.error(
        "link:hot-reload-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Marks every waiting request whose socket was replaced as confirmed: the state just came in on a
 * socket opened after the request started (the reconnect).
 *
 * @param state - Link state.
 */
function confirmWaiters(state: LinkState): void {
  for (const waiter of state.hotReloadWaiters) {
    if (waiter.before === state.socket) continue;
    waiter.delivered = true;
    waiter.settle?.(true);
  }
}

/**
 * Handles the params of an `editor.hotReload` notification; a malformed one is logged at warn.
 * A well-formed one also confirms the requests waiting for a reconnect, the same state included.
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onHotReloadNote(ctx: LinkCtx, params: Json | undefined): void {
  const next = readHotReload(params);
  if (next === undefined) {
    ctx.log.warn("link:bad-hot-reload", {});
    return;
  }
  applyHotReload(ctx, next);
  confirmWaiters(ctx.state);
}

/**
 * Ends every bounded wait with false; onStop calls it.
 *
 * @param state - Link state.
 */
export function settleWaiters(state: LinkState): void {
  for (const waiter of state.hotReloadWaiters) waiter.settle?.(false);
  state.hotReloadWaiters.clear();
}

/**
 * Adds a hot reload listener; it is called at once when the state is known.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each new state.
 * @returns An idempotent unsubscribe.
 */
export function addHotReloadListener(
  ctx: LinkCtx,
  listener: (state: HotReload) => void
): () => void {
  const { state } = ctx;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param next - The state to pass on.
   */
  const entry = (next: HotReload): void => {
    listener(next);
  };

  state.hotReloadListeners.add(entry);
  if (state.hotReload !== undefined) entry(state.hotReload);
  return () => {
    state.hotReloadListeners.delete(entry);
  };
}

/**
 * The URL of `{path}/hmr`: on the page origin, or on the http origin of the boot socket outside a
 * page.
 *
 * @param boot - The boot data.
 * @returns The absolute URL.
 * @example
 * ```ts
 * hmrUrl(boot); // "http://127.0.0.1:3000/__editor/hmr"
 * ```
 */
function hmrUrl(boot: ToolsBoot): string {
  const base = pageHref() ?? boot.ws.replace(/^ws/, "http");
  return new URL(`${boot.path}/hmr`, base).href;
}

/**
 * Reads the state out of a `{path}/hmr` body; another body reads as undefined.
 *
 * @param text - The body.
 * @returns The state, or undefined.
 * @example
 * ```ts
 * stateOf('{"hmr":true,"owner":"bin"}'); // { hmr: true, owner: "bin" }
 * stateOf("unauthorized"); // undefined
 * ```
 */
function stateOf(text: string): HotReload | undefined {
  try {
    const parsed: Json = JSON.parse(text);
    return readHotReload(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Sends `POST {path}/hmr` with `{ hmr }` and the boot token, and reads the whole body.
 *
 * @param boot - The boot data.
 * @param on - The asked value.
 * @returns The answer; undefined when the network failed (the request, or the body cut off).
 */
async function postHmr(boot: ToolsBoot, on: boolean): Promise<HmrAnswer | undefined> {
  try {
    const response = await fetch(hmrUrl(boot), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${boot.token}`, "content-type": "application/json" },
      body: JSON.stringify({ hmr: on })
    });
    return { ok: response.ok, state: stateOf(await response.text()) };
  } catch {
    return undefined;
  }
}

/**
 * Waits until a reconnect delivered the hot reload state, at most HOT_RELOAD_CONFIRM_MS.
 *
 * @param waiter - The waiter of the request.
 * @returns True once delivered; false on timeout or stop.
 */
function reconnectDelivered(waiter: HotReloadWaiter): Promise<boolean> {
  if (waiter.delivered) return Promise.resolve(true);

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiter.settle = undefined;
      resolve(false);
    }, HOT_RELOAD_CONFIRM_MS);

    waiter.settle = delivered => {
      clearTimeout(timer);
      waiter.settle = undefined;
      resolve(delivered);
    };
  });
}

/**
 * Asks the server for hot reload on or off: `POST {path}/hmr` with `{ hmr }` and the boot token.
 * The state the server answers is applied. A network failure (the bin restarts its server for a
 * change, D-32) waits for the reconnect to deliver the state and compares it (A1). Never rejects.
 *
 * @param ctx - Domain context of link.
 * @param on - The asked value.
 * @returns True when the bin owns the server and its HMR now equals `on`; false otherwise.
 */
export async function requestHotReload(ctx: LinkCtx, on: boolean): Promise<boolean> {
  const { state } = ctx;
  const { boot } = state;
  if (boot === undefined) return false;

  const waiter: HotReloadWaiter = { before: state.socket, delivered: false, settle: undefined };
  state.hotReloadWaiters.add(waiter);
  try {
    const answer = await postHmr(boot, on);
    if (answer === undefined) {
      ctx.log.warn("link:hot-reload-failed", { hmr: on });
      return (await reconnectDelivered(waiter)) && state.hotReload?.hmr === on;
    }

    if (answer.state !== undefined) applyHotReload(ctx, answer.state);
    return answer.ok && answer.state?.owner === "bin" && answer.state.hmr === on;
  } finally {
    state.hotReloadWaiters.delete(waiter);
  }
}
