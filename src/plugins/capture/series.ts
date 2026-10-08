/**
 * @file capture plugin — the series: the pure plan, the sequential recording loop, the stop and
 * the browser clock.
 */
import type { RunState } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import { takeShot } from "./shot";
import type {
  CaptureClock,
  CaptureDeps,
  CaptureRegistry,
  CaptureState,
  Config,
  SeriesPlan,
  SeriesResult,
  SeriesRun,
  SeriesShot
} from "./types";

/**
 * The id of the series command, named in its errors.
 */
export const SERIES_ID = "editor.series";

/**
 * The browser clock: performance.now and a setTimeout wait that stores its timer on the run.
 */
export const browserClock: CaptureClock = {
  /**
   * The current time in ms (performance.now).
   *
   * @returns Milliseconds since the page started.
   */
  now(): number {
    return performance.now();
  },
  /**
   * Waits `ms`; stores the timer and the resolver on the run so a stop ends the wait at once.
   * A run that is already stopped does not wait.
   *
   * @param ms - Milliseconds to wait.
   * @param run - The running series.
   * @returns A promise that resolves after `ms`, or at once on a stop.
   */
  wait(ms: number, run: SeriesRun): Promise<void> {
    if (run.stopRequested) return Promise.resolve();

    return new Promise<void>(resolve => {
      /**
       * Ends the wait: clears the timer, forgets the resolver and resolves.
       */
      const finish = (): void => {
        clearTimeout(run.timer);
        run.timer = undefined;
        run.wake = undefined;
        resolve();
      };
      run.wake = finish;
      run.timer = setTimeout(finish, ms);
    });
  }
};

/**
 * Builds the -32602 refusal of a series input field.
 *
 * @param field - The refused field.
 * @param message - The two-line message (spec/11 §Part 3 format).
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw refused("intervalMs", "[moku-editor] editor.series: intervalMs must be at least 16.\n  One frame is the shortest interval.");
 * ```
 */
function refused(field: string, message: string): Error {
  return wireError(errorCode.invalidInput, message, {
    reason: "invalid_input",
    retryable: false,
    id: SERIES_ID,
    field
  });
}

/**
 * Validates and plans a series; refusals throw -32602 naming the field. Shot k is due at
 * k × intervalMs, for k = 0 … count - 1.
 *
 * @param input - The checked editor.series input.
 * @param input.durationMs - Length of the series in ms.
 * @param input.intervalMs - Time between two shots in ms.
 * @param config - The capture config (limits).
 * @returns The plan: the shot count and the two times.
 * @throws {Error} -32602 `invalid_input` naming `durationMs` or `intervalMs`.
 * @example
 * ```ts
 * planSeries({ durationMs: 2000, intervalMs: 100 }, config).count; // 20
 * ```
 */
export function planSeries(
  input: { readonly durationMs: number; readonly intervalMs: number },
  config: Readonly<Config>
): SeriesPlan {
  const { durationMs, intervalMs } = input;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw refused(
      "durationMs",
      `[moku-editor] ${SERIES_ID}: durationMs must be a positive number.\n  Pass the length of the series in milliseconds.`
    );
  }
  if (durationMs > config.maxDurationMs) {
    throw refused(
      "durationMs",
      `[moku-editor] ${SERIES_ID}: durationMs must be at most ${config.maxDurationMs}.\n  Record a shorter series.`
    );
  }
  if (!Number.isFinite(intervalMs) || intervalMs < config.minIntervalMs) {
    throw refused(
      "intervalMs",
      `[moku-editor] ${SERIES_ID}: intervalMs must be at least ${config.minIntervalMs}.\n  One frame is the shortest interval.`
    );
  }

  return { count: Math.max(1, Math.floor(durationMs / intervalMs)), durationMs, intervalMs };
}

/**
 * Builds the -32000 error of a series that took no picture.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * if (shots.length === 0) throw noPicture();
 * ```
 */
export function noPicture(): Error {
  return wireError(
    errorCode.commandFailed,
    `[moku-editor] ${SERIES_ID} took no picture.\n  The renderer is inert, headless or this is not a dev build.`,
    { reason: "command_failed", retryable: false, id: SERIES_ID }
  );
}

/**
 * The shots and the state a running series collects.
 */
type Collected = { readonly shots: SeriesShot[]; state: RunState | undefined; skipped: number };

/**
 * Takes one shot and adds it to the collection; a shot that fails is counted as skipped.
 *
 * @param registry - The registry slice.
 * @param collected - The collection so far.
 * @param atMs - When the shot started, in ms since the series start.
 * @returns A promise that resolves once the shot is collected or skipped.
 */
async function collectShot(
  registry: CaptureRegistry,
  collected: Collected,
  atMs: number
): Promise<void> {
  try {
    const { image, state } = await takeShot(registry);
    collected.shots.push({ image, frame: state.frame, atMs: Math.round(atMs) });
    collected.state = state;
  } catch {
    collected.skipped += 1;
  }
}

/**
 * How long a series may run late past its durationMs, in ms. It stays under the 5 s the bridge,
 * the hub and the link add to a series call (`callTimeoutMs` on top of durationMs), leaving room
 * for the last shot and the answer.
 */
const LATE_GRACE_MS = 3000;

/**
 * The time after which a series stops even with planned shots left: its length plus three
 * seconds. Slow shots (the first capture after a page load warms the GPU readback) are taken late;
 * only a renderer far slower than planned ends a series early.
 *
 * @param plan - The series plan.
 * @returns The ceiling in ms since the series start.
 * @example
 * ```ts
 * lateCeilingMs({ count: 4, durationMs: 1000, intervalMs: 250 }); // 4000
 * lateCeilingMs({ count: 1250, durationMs: 20_000, intervalMs: 16 }); // 23000
 * ```
 */
export function lateCeilingMs(plan: SeriesPlan): number {
  return plan.durationMs + LATE_GRACE_MS;
}

/**
 * The recording loop: takes the planned count of shots, each at its due time or late; stops on a
 * stop request or at the late ceiling.
 *
 * @param plan - The series plan.
 * @param registry - The registry slice.
 * @param clock - The clock.
 * @param run - The running series.
 * @returns What the series collected.
 */
async function loop(
  plan: SeriesPlan,
  registry: CaptureRegistry,
  clock: CaptureClock,
  run: SeriesRun
): Promise<Collected> {
  const collected: Collected = { shots: [], state: undefined, skipped: 0 };
  const start = clock.now();
  const ceiling = lateCeilingMs(plan);

  for (let shot = 0; shot < plan.count && !run.stopRequested; shot += 1) {
    const delay = start + shot * plan.intervalMs - clock.now();

    if (delay > 0) await clock.wait(delay, run);

    const elapsed = clock.now() - start;

    if (run.stopRequested || elapsed >= ceiling) break;
    await collectShot(registry, collected, elapsed);
  }

  return collected;
}

/**
 * Records the planned count of shots one after the other; late shots are taken late, never
 * dropped for lateness, up to the late ceiling (`lateCeilingMs`); failed shots are skipped and
 * logged once (`capture:shots-skipped`). The run sits in `state.series` while recording.
 *
 * @param plan - The series plan.
 * @param registry - The registry slice (game.capture entry).
 * @param deps - Config, state, log and clock.
 * @returns The shots, the state of the last good shot and the skipped count.
 */
export async function recordSeries(
  plan: SeriesPlan,
  registry: CaptureRegistry,
  deps: CaptureDeps
): Promise<SeriesResult> {
  const run: SeriesRun = { stopRequested: false, timer: undefined, wake: undefined };
  deps.state.series = run;

  try {
    const { shots, state, skipped } = await loop(plan, registry, deps.clock, run);

    if (skipped > 0) deps.log.warn("capture:shots-skipped", { skipped });

    return { shots, state, skipped };
  } finally {
    if (deps.state.series === run) deps.state.series = undefined;
  }
}

/**
 * Ends the running series early: stop flag, timer cleared, pending wait woken. The pending
 * editor.series call then resolves with the shots taken so far.
 *
 * @param state - The capture state.
 * @returns True when a series was running.
 */
export function stopSeries(state: CaptureState): boolean {
  const run = state.series;

  if (run === undefined) return false;

  run.stopRequested = true;
  clearTimeout(run.timer);
  run.timer = undefined;
  run.wake?.();

  return true;
}
