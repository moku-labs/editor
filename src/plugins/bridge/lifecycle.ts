/**
 * @file bridge plugin — config check (onInit), the domain deps, start (onStart: heartbeat
 * listener, page listener, connect — not awaited) and stop (onStop: bye, close, clear timers).
 */
import { channelPlugin } from "../channel";
import { registryPlugin } from "../registry";
import { encode, notification } from "../registry/protocol";
import { connectInBackground, onBeat } from "./connection/loop";
import { defaultNet } from "./connection/socket";
import { dropInflight, NORMAL_CLOSE, SOCKET_OPEN } from "./dispatch/send";
import { dropAll } from "./dispatch/subscriptions";
import { watchVisibility } from "./page";
import { setStatus } from "./status";
import type { BridgeConfig, BridgeCtx, BridgeDeps, BridgeState } from "./types";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_RETRY_MS } from "./types";

/**
 * The smallest retryMs and callTimeoutMs.
 */
const MIN_MS = 100;

/**
 * Builds a config error in the two-line format (spec/11 Part 3, R7 prefix).
 *
 * @param field - The config field.
 * @param rule - What it must be.
 * @param example - A valid value, as written in code.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw configError("retryMs", "a whole number of at least 100", "1000");
 * ```
 */
function configError(field: string, rule: string, example: string): Error {
  return new Error(
    `[moku-editor] bridge.${field} must be ${rule}.\n  Fix pluginConfigs.bridge.${field}, for example ${example}.`
  );
}

/**
 * Rejects a value that is not a finite integer ≥ 100.
 *
 * @param field - The config field.
 * @param value - Its value.
 * @param example - Its default.
 * @throws {Error} `[moku-editor] bridge.<field> must be a whole number of at least 100.`
 * @example
 * ```ts
 * checkWhole("retryMs", 50, 1000); // throws
 * ```
 */
function checkWhole(field: string, value: number, example: number): void {
  if (Number.isInteger(value) && value >= MIN_MS) return;
  throw configError(field, `a whole number of at least ${String(MIN_MS)}`, String(example));
}

/**
 * onInit: `hello` non-empty; `retryMs`, `callTimeoutMs` finite integers ≥ 100.
 *
 * @param ctx - Plugin context.
 * @param ctx.config - Resolved plugin config.
 * @throws {Error} `[moku-editor] bridge.<field> must be <rule>.`
 */
export function checkConfig(ctx: { readonly config: Readonly<BridgeConfig> }): void {
  const { hello, retryMs, callTimeoutMs } = ctx.config;
  const isHelloSet = typeof hello === "string" && hello !== "";
  if (!isHelloSet) throw configError("hello", "a non-empty string", '"/__editor/hello"');

  checkWhole("retryMs", retryMs, DEFAULT_RETRY_MS);
  checkWhole("callTimeoutMs", callTimeoutMs, DEFAULT_CALL_TIMEOUT_MS);
}

/**
 * Builds the domain deps: registry and channel through ctx.require, emit of bridge:status,
 * defaultNet(globalThis) and the page probe.
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The deps every bridge module takes.
 */
export function depsOf(ctx: BridgeCtx): BridgeDeps {
  return {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    /**
     * Emits the global agent event (fire and forget).
     *
     * @param payload - The status and the session.
     */
    emit: payload => {
      ctx.emit("bridge:status", payload);
    },
    registry: ctx.require(registryPlugin),
    channel: ctx.require(channelPlugin),
    net: defaultNet(globalThis),
    page: { href: globalThis.location?.href, document: globalThis.document }
  };
}

/**
 * onStart: publishes connecting, installs the heartbeat and visibility listeners, then connects
 * without awaiting: `app.start()` never waits for, or fails on, the editor server.
 *
 * @param ctx - Plugin context of the bridge.
 */
export function startBridge(ctx: BridgeCtx): void {
  const deps = depsOf(ctx);
  setStatus(deps, { kind: "connecting" }, true);
  deps.state.off.push(
    deps.channel.onHeartbeat(beat => {
      onBeat(deps, beat);
    }),
    watchVisibility(deps)
  );
  connectInBackground(deps);
}

/**
 * onStop: phase stopped, timers cleared, listeners removed, subs stopped, bye + normal close.
 * Teardown context only: no emit, no log.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopBridge(ctx: { readonly state: BridgeState }): void {
  const { state } = ctx;

  // Nothing may act again: no retry, no deadline, no listener, no subscription.
  state.phase = "stopped";
  if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
  dropInflight(state);
  for (const off of state.off.splice(0)) off();
  dropAll({ state });

  // Forget the socket; say bye on it when it is open, then close it.
  const { socket } = state;
  state.socket = undefined;
  state.session = undefined;
  if (socket === undefined) return;
  if (socket.readyState !== SOCKET_OPEN) {
    socket.close();
    return;
  }
  socket.send(encode(notification("game", "bye")));
  socket.close(NORMAL_CLOSE, "bye");
}
