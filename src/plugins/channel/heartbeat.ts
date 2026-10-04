/**
 * @file channel plugin — config check (onInit), the beat (with the page heap where Chromium
 * reports it), the heartbeat interval (onStart) and the teardown (onStop).
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
 */
export function checkConfig(ctx: { readonly config: Readonly<ChannelConfig> }): void {
  const { heartbeatMs } = ctx.config;
  if (Number.isInteger(heartbeatMs) && heartbeatMs >= MIN_HEARTBEAT_MS) return;

  throw new Error(
    `[moku-editor] channel.heartbeatMs must be a whole number of at least ${String(MIN_HEARTBEAT_MS)}.\n  Pass pluginConfigs.channel.heartbeatMs, for example 1000.`
  );
}

/**
 * Bytes in one MB (MiB, the unit Chromium's task manager shows).
 */
const BYTES_PER_MB = 2 ** 20;

/**
 * A byte count in MB, rounded to 0.1.
 *
 * @param bytes - The byte count.
 * @returns The MB value, e.g. 12.8.
 * @example
 * ```ts
 * toMb(13_421_773); // 12.8
 * ```
 */
function toMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/**
 * The JS heap of the page from Chromium's non-standard `performance.memory`, frozen.
 *
 * @returns `{ usedMb, limitMb }`, or undefined where the runtime has no such counters.
 */
function heapOf(): Heartbeat["heap"] {
  if (!("memory" in performance)) return undefined;
  const { memory } = performance;
  if (typeof memory !== "object" || memory === null) return undefined;
  if (!("usedJSHeapSize" in memory) || !("jsHeapSizeLimit" in memory)) return undefined;

  const { usedJSHeapSize, jsHeapSizeLimit } = memory;
  if (typeof usedJSHeapSize !== "number" || !Number.isFinite(usedJSHeapSize)) return undefined;
  if (typeof jsHeapSizeLimit !== "number" || !Number.isFinite(jsHeapSizeLimit)) return undefined;
  return Object.freeze({ usedMb: toMb(usedJSHeapSize), limitMb: toMb(jsHeapSizeLimit) });
}

/**
 * A frozen beat from the registry clock, with the page heap where the runtime reports it.
 *
 * @param registry - The registry slice with `clock()`.
 * @param now - Epoch ms of the beat.
 * @returns `{ frame, paused, at }` plus `heap` when present, frozen.
 */
export function beatOf(registry: ChannelRegistry, now: number): Heartbeat {
  const { frame, paused } = registry.clock();
  const heap = heapOf();
  return Object.freeze(
    heap === undefined ? { frame, paused, at: now } : { frame, paused, at: now, heap }
  );
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
 */
export function startHeartbeat(ctx: ChannelCtx): void {
  beginHeartbeat(depsOf(ctx));
}

/**
 * onStop: clears the interval, closes every watch, clears the listeners.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopChannel(ctx: { readonly state: ChannelState }): void {
  const { state } = ctx;
  if (state.timer !== undefined) clearInterval(state.timer);
  state.timer = undefined;
  for (const stop of state.watches) stop();
  state.listeners.clear();
}
