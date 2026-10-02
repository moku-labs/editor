/**
 * @file capture plugin — the series: the pure plan, the sequential recording loop and the
 * browser clock.
 */
import type {
  CaptureClock,
  CaptureDeps,
  CaptureRegistry,
  Config,
  SeriesPlan,
  SeriesResult,
  SeriesRun
} from "./types";

/**
 * The browser clock: performance.now and a setTimeout wait that stores its timer on the run.
 */
export const browserClock: CaptureClock = {
  /**
   * The current time in ms (performance.now).
   *
   * @example
   * ```ts
   * const start = browserClock.now();
   * ```
   */
  now(): number {
    throw new Error("not implemented");
  },
  /**
   * Waits `ms`; stores the timer and the resolver on the run so a stop ends the wait at once.
   *
   * @param _ms - Milliseconds to wait.
   * @param _run - The running series.
   * @example
   * ```ts
   * await browserClock.wait(100, run);
   * ```
   */
  wait(_ms: number, _run: SeriesRun): Promise<void> {
    throw new Error("not implemented");
  }
};

/**
 * Validates and plans a series; refusals throw -32602 naming the field.
 *
 * @param _input - The checked editor.series input.
 * @param _input.durationMs - Length of the series in ms.
 * @param _input.intervalMs - Time between two shots in ms.
 * @param _config - The capture config (limits).
 * @example
 * ```ts
 * planSeries({ durationMs: 2000, intervalMs: 100 }, config).count; // 20
 * ```
 */
export function planSeries(
  _input: { readonly durationMs: number; readonly intervalMs: number },
  _config: Readonly<Config>
): SeriesPlan {
  throw new Error("not implemented");
}

/**
 * Records the planned shots one after the other; late shots are taken late, never dropped for
 * lateness; shots after durationMs are dropped.
 *
 * @param _plan - The series plan.
 * @param _registry - The registry slice (game.capture entry).
 * @param _deps - Config, state, log and clock.
 * @example
 * ```ts
 * const { shots } = await recordSeries(plan, registry, deps);
 * ```
 */
export function recordSeries(
  _plan: SeriesPlan,
  _registry: CaptureRegistry,
  _deps: CaptureDeps
): Promise<SeriesResult> {
  throw new Error("not implemented");
}
