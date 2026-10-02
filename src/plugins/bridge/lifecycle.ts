/**
 * @file bridge plugin — config check (onInit), the domain deps, start (onStart: heartbeat
 * listener, page listener, connect — not awaited) and stop (onStop: bye, close, clear timers).
 */
import type { BridgeConfig, BridgeCtx, BridgeDeps, BridgeState } from "./types";

/**
 * onInit: `hello` non-empty; `retryMs`, `callTimeoutMs` finite integers ≥ 100.
 *
 * @param _ctx - Plugin context.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} `[moku-editor] bridge.<field> must be <rule>.`
 * @example
 * ```ts
 * createAgentPlugin("bridge", { onInit: checkConfig });
 * ```
 */
export function checkConfig(_ctx: { readonly config: Readonly<BridgeConfig> }): void {
  throw new Error("not implemented");
}

/**
 * Builds the domain deps: registry and channel through ctx.require, emit of bridge:status,
 * defaultNet(globalThis) and the page probe.
 *
 * @param _ctx - Plugin context of the bridge.
 * @example
 * ```ts
 * const deps = depsOf(ctx);
 * ```
 */
export function depsOf(_ctx: BridgeCtx): BridgeDeps {
  throw new Error("not implemented");
}

/**
 * onStart: installs the heartbeat and visibility listeners, then connects without awaiting.
 *
 * @param _ctx - Plugin context of the bridge.
 * @example
 * ```ts
 * createAgentPlugin("bridge", { onStart: startBridge });
 * ```
 */
export function startBridge(_ctx: BridgeCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: phase stopped, timers cleared, listeners removed, subs stopped, bye + close 1000.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createAgentPlugin("bridge", { onStop: stopBridge });
 * ```
 */
export function stopBridge(_ctx: { readonly state: BridgeState }): void {
  throw new Error("not implemented");
}
