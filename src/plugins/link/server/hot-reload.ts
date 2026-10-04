/**
 * @file link plugin — hot reload of the game server (R6): the state the hub publishes as
 * `editor.hotReload`, its listeners, and the change request `POST {path}/hmr` with the boot token
 * as a Bearer. The state is a server fact shared by every tools tab, never stored in the page.
 */
import type { HotReload, Json, ToolsBoot } from "../../registry/protocol";
import { pageHref } from "../boot/read";
import { readHotReload } from "../rpc/shapes";
import type { LinkCtx } from "../types";

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
 * Handles the params of an `editor.hotReload` notification; a malformed one is logged at warn.
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onHotReloadNote(ctx: LinkCtx, params: Json | undefined): void {
  const next = readHotReload(params);
  if (next === undefined) ctx.log.warn("link:bad-hot-reload", {});
  else applyHotReload(ctx, next);
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
 * Reads the state out of a `{path}/hmr` answer; another body reads as undefined.
 *
 * @param response - The answer.
 * @returns The state, or undefined.
 */
async function stateOf(response: Response): Promise<HotReload | undefined> {
  try {
    const parsed: Json = JSON.parse(await response.text());
    return readHotReload(parsed);
  } catch {
    return undefined;
  }
}

/**
 * Asks the server for hot reload on or off: `POST {path}/hmr` with `{ hmr }` and the boot token.
 * The state the server answers is applied; a refused change answers 200 with the unchanged state.
 * Never rejects.
 *
 * @param ctx - Domain context of link.
 * @param on - The asked value.
 * @returns True when the answer is ok and its state has hot reload `on`, false otherwise.
 */
export async function requestHotReload(ctx: LinkCtx, on: boolean): Promise<boolean> {
  const { boot } = ctx.state;
  if (boot === undefined) return false;

  let response: Response;
  try {
    response = await fetch(hmrUrl(boot), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${boot.token}`, "content-type": "application/json" },
      body: JSON.stringify({ hmr: on })
    });
  } catch {
    ctx.log.warn("link:hot-reload-failed", { hmr: on });
    return false;
  }

  const answered = await stateOf(response);
  if (answered !== undefined) applyHotReload(ctx, answered);
  return response.ok && answered?.hmr === on;
}
