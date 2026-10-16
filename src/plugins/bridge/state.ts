/**
 * @file bridge plugin — state factory.
 */
import type { BridgeConfig, BridgeState } from "./types";

/**
 * Creates the initial bridge state: phase idle, status connecting, page mode, empty maps, nothing
 * restored, nothing remembered yet (start reads the store: createState must not touch the page).
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state with its own maps and remover list.
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
    off: [],
    restored: undefined,
    dial: 0,
    mode: "page",
    address: undefined,
    pairing: undefined,
    pairNext: false,
    editorEngine: undefined,
    seenAt: undefined,
    seenEmittedAt: 0,
    emittedLink: undefined,
    everLinked: false,
    shipping: undefined,
    shippingStalled: false,
    remembered: { v: 1, last: undefined, links: {} }
  };
}
