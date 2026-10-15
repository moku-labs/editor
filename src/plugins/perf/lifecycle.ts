/**
 * @file perf plugin — the lifecycle: find the monitor and add the sources (onInit), subscribe to the
 * stream and start the read timer (onStart), free both (onStop).
 */
import { registryPlugin } from "../registry";
import { addPerfEntries } from "./entries";
import { monitorOf, offReasonOf } from "./protocol";
import { readTick } from "./reader";
import { listen } from "./stream";
import type { PerfCtx, PerfStopCtx } from "./types";

/**
 * onInit: finds the engine monitor on the registry's game, adds the five sources and, without a
 * monitor, logs `perf:off` with the reason once. The config was checked when the state was made.
 *
 * @param ctx - The plugin context.
 */
export function initPerf(ctx: PerfCtx): void {
  const { state } = ctx;
  const registry = ctx.require(registryPlugin);
  const game = registry.game();
  state.game = game;
  state.log = ctx.log;
  state.monitor = monitorOf(game);
  state.off = offReasonOf(game);
  addPerfEntries(registry, state, ctx.config);
  if (state.off !== undefined) ctx.log.info("perf:off", { reason: state.off });
}

/**
 * onStart: with a monitor, subscribes to its stream (the header may arrive before `stream` returns),
 * reads once at once and starts the read timer. Without one: no timer, no listener.
 *
 * @param ctx - The plugin context.
 */
export function startPerf(ctx: PerfCtx): void {
  const { state, config } = ctx;
  const { monitor } = state;
  if (monitor === undefined) return;

  const tick = (): void => readTick(state, config);
  state.unsubscribe = monitor.stream(line => listen(state, line));
  try {
    tick();
  } catch (error) {
    // A first read that throws fails the start: leave no listener behind (the timer is not set yet).
    state.unsubscribe();
    state.unsubscribe = undefined;
    throw error;
  }
  state.timer = setInterval(tick, config.readEveryMs);
  ctx.log.debug("perf:started", { readEveryMs: config.readEveryMs, windowMs: config.windowMs });
}

/**
 * onStop: clears the timer, unsubscribes, drops the watches, empties the window (its arrays stay
 * for a restart) and forgets the rest and the last awake p90.
 *
 * @param ctx - The teardown context: own config and state.
 */
export function stopPerf(ctx: PerfStopCtx): void {
  const { state } = ctx;
  clearInterval(state.timer);
  state.timer = undefined;
  state.unsubscribe?.();
  state.unsubscribe = undefined;
  state.watchers.clear();
  state.cursor = undefined;
  state.measuring = false;
  state.fpsLoop = 0;
  state.fpsDrawn = 0;
  state.idleSinceT = undefined;
  state.awakeP90Ms = Number.NaN;
  state.second = undefined;
  state.window.count = 0;
  state.window.spikeCount = 0;
  state.window.version += 1;
}
