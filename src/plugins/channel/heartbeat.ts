/**
 * @file channel plugin — config check (onInit), the beat, the heartbeat interval (onStart) and
 * the teardown (onStop).
 */
import type { Heartbeat } from "../registry/protocol";
import { depsOf } from "./deps";
import type {
  ChannelConfig,
  ChannelCtx,
  ChannelDeps,
  ChannelRegistry,
  ChannelState
} from "./types";

/**
 * The smallest heartbeat interval in milliseconds.
 */
const MIN_HEARTBEAT_MS = 100;

/**
 * onInit: rejects a heartbeatMs that is not a finite integer ≥ 100.
 *
 * @param ctx - Plugin context.
 * @param ctx.config - Resolved plugin config.
 * @throws {Error} `[moku-editor] channel.heartbeatMs must be a whole number of at least 100.`
 * @example
 * ```ts
 * checkConfig({ config: { heartbeatMs: 1000 } }); // passes
 * checkConfig({ config: { heartbeatMs: 50 } }); // throws
 * ```
 */
export function checkConfig(ctx: { readonly config: Readonly<ChannelConfig> }): void {
  const { heartbeatMs } = ctx.config;
  if (Number.isInteger(heartbeatMs) && heartbeatMs >= MIN_HEARTBEAT_MS) return;

  throw new Error(
    `[moku-editor] channel.heartbeatMs must be a whole number of at least ${String(MIN_HEARTBEAT_MS)}.\n  Pass pluginConfigs.channel.heartbeatMs, for example 1000.`
  );
}

/**
 * A frozen beat from the registry clock.
 *
 * @param registry - The registry slice with `clock()`.
 * @param now - Epoch ms of the beat.
 * @returns `{ frame, paused, at }`, frozen.
 * @example
 * ```ts
 * beatOf(registry, Date.now()); // { frame: 1840, paused: true, at: 1790000000000 }
 * ```
 */
export function beatOf(registry: ChannelRegistry, now: number): Heartbeat {
  const { frame, paused } = registry.clock();
  return Object.freeze({ frame, paused, at: now });
}

/**
 * The message of a thrown value.
 *
 * @param error - What a listener threw.
 * @returns Its message, or its text.
 * @example
 * ```ts
 * messageOf(new Error("boom")); // "boom"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lets the process exit while the interval runs (Bun and Node timers have `unref`; browsers
 * return a number).
 *
 * @param timer - The interval handle.
 * @example
 * ```ts
 * unrefTimer(setInterval(tick, 1000));
 * ```
 */
function unrefTimer(timer: unknown): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    const { unref } = timer;
    if (typeof unref === "function") unref.call(timer);
  }
}

/**
 * Builds one beat and gives it to every listener in subscription order; a throwing listener is
 * logged and the others still run.
 *
 * @param deps - Domain deps of the channel.
 * @example
 * ```ts
 * setInterval(() => tick(deps), deps.config.heartbeatMs);
 * ```
 */
function tick(deps: ChannelDeps): void {
  const beat = beatOf(deps.registry, Date.now());
  for (const listener of deps.state.listeners) {
    try {
      listener(beat);
    } catch (error) {
      deps.log.warn("channel:heartbeat-listener-failed", { message: messageOf(error) });
    }
  }
}

/**
 * Starts the heartbeat interval over the given deps (replacing a running one). No beat is sent
 * at start.
 *
 * @param deps - Domain deps of the channel.
 * @example
 * ```ts
 * beginHeartbeat(deps); // listeners get a beat every deps.config.heartbeatMs
 * ```
 */
export function beginHeartbeat(deps: ChannelDeps): void {
  const { state } = deps;
  if (state.timer !== undefined) clearInterval(state.timer);
  state.timer = setInterval(() => {
    tick(deps);
  }, deps.config.heartbeatMs);
  unrefTimer(state.timer);
}

/**
 * onStart: starts the setInterval heartbeat (unref'd in Bun).
 *
 * @param ctx - Domain context of the channel.
 * @example
 * ```ts
 * createAgentPlugin("channel", { onStart: startHeartbeat });
 * ```
 */
export function startHeartbeat(ctx: ChannelCtx): void {
  beginHeartbeat(depsOf(ctx));
}

/**
 * onStop: clears the interval, closes every watch, clears the listeners.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 * @example
 * ```ts
 * createAgentPlugin("channel", { onStop: stopChannel });
 * ```
 */
export function stopChannel(ctx: { readonly state: ChannelState }): void {
  const { state } = ctx;
  if (state.timer !== undefined) clearInterval(state.timer);
  state.timer = undefined;
  for (const stop of state.watches) stop();
  state.listeners.clear();
}
