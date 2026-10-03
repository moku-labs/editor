/**
 * @file bridge plugin — state factory.
 */
import type { BridgeConfig, BridgeState } from "./types";

/**
 * Creates the initial bridge state: phase idle, status connecting, empty maps.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state with its own maps and remover list.
 * @example
 * ```ts
 * const state = createBridgeState({ config });
 * state.phase; // "idle"
 * ```
 */
export function createBridgeState(_ctx: { readonly config: Readonly<BridgeConfig> }): BridgeState {
  return {
    phase: "idle",
    status: { kind: "connecting" },
    session: undefined,
    socket: undefined,
    attempt: 0,
    retryTimer: undefined,
    failureLogged: false,
    lastFrame: 0,
    subs: new Map(),
    pending: new Map(),
    inflight: new Map(),
    off: []
  };
}
