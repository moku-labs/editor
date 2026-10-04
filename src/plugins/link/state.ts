/**
 * @file link plugin — state factory and the state queries shared by the sub-modules.
 */
import { createFrameId } from "./sessions/frame";
import type { Config, LinkState } from "./types";

/**
 * Creates the initial link state: status connecting, nothing attached, ids from 1, a new random
 * frame id.
 *
 * @param _ctx - Minimal context (unused: the state does not depend on the config).
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state.
 */
export function createLinkState(_ctx: { readonly config: Readonly<Config> }): LinkState {
  return {
    status: { kind: "connecting" },
    boot: undefined,
    socket: undefined,
    open: false,
    attempt: 0,
    nextId: 1,
    pending: new Map(),
    sessions: [],
    chosen: undefined,
    sticky: false,
    manifests: new Map(),
    manifestListeners: new Set(),
    tapListeners: new Set(),
    hotReload: undefined,
    hotReloadListeners: new Set(),
    subs: new Map(),
    wire: new Map(),
    nextSub: 1,
    generation: 0,
    nextKey: 1,
    heartbeat: undefined,
    lostAt: undefined,
    retryTimer: undefined,
    silenceTimer: undefined,
    stopped: false,
    frame: createFrameId()
  };
}

/**
 * True when the chosen session is attached on the open socket. The session list is cleared when
 * the socket closes, so after a reconnect the chosen id is not in it until the hub's first
 * `sessions` notification re-attaches it.
 *
 * @param state - Link state.
 * @returns Whether `chosen` is attached on the current socket.
 */
export function isAttached(state: LinkState): boolean {
  const { chosen } = state;
  return state.open && chosen !== undefined && state.sessions.some(({ id }) => id === chosen);
}

/**
 * Cancels the pending retry (reconnect or session retry), if any.
 *
 * @param state - Link state.
 */
export function clearRetry(state: LinkState): void {
  if (state.retryTimer === undefined) return;
  clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
}
