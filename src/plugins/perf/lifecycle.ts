/**
 * @file perf plugin — the lifecycle: find the monitor and add the sources and the command (onInit),
 * subscribe to the stream, read the engine's sections once and start the read timer (onStart), free
 * both and forget the run (onStop).
 */
import { registryPlugin } from "../registry";
import { addPerfEntries } from "./entries";
import { readSections } from "./feeds";
import { monitorOf, offReasonOf } from "./protocol";
import { readTick } from "./reader";
import { listen } from "./stream";
import type { PerfCtx, PerfStopCtx } from "./types";

/**
 * onInit: finds the engine monitor on the registry's game, adds the sources and the command and,
 * without a monitor, logs `perf:off` with the reason once. The config was checked when the state
 * was made.
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
 * reads the engine's sections once (an engine with `monitor.sections`), reads the ring once at once
 * and starts the read timer. Without one: no timer, no listener.
 *
 * @param ctx - The plugin context.
 */
export function startPerf(ctx: PerfCtx): void {
  const { state, config } = ctx;
  const { monitor } = state;
  if (monitor === undefined) return;

  const tick = (): void => readTick(state, config);
  state.unsubscribe = monitor.stream(line => listen(state, line));
  readSections(state);
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
 * onStop: clears the timer, unsubscribes, drops the watches, empties the window and the pass
 * window (their arrays stay for a restart), lets go of the kept timeline lines (the seq goes on) and
 * forgets the rest, the last awake p90, the cursors and the capabilities of the run.
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
  state.passes.count = 0;
  state.passCursor = undefined;
  state.capsStale = true;
  // eslint-disable-next-line unicorn/no-useless-undefined -- fill needs the value it writes
  state.timeline.fill(undefined);
  // eslint-disable-next-line unicorn/no-useless-undefined -- as above
  state.passesLines.fill(undefined);
  state.namesRef = undefined;
  state.namesLength = 0;
}
