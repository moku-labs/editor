/**
 * @file renderView view — the display clock of every live graph (spec 09 Amendment 2026-10-16,
 * § M11; moved by RV0 from the device strip's `device/playout.ts`, behaviour unchanged): like a video
 * jitter buffer, the graphs are drawn at a clock that runs at real time and sits behind the newest
 * data by a playout delay, so the right edge keeps moving between two arrivals of the frames feed
 * (about 1 Hz). The delay follows the measured arrival interval; the clock is trimmed softly toward
 * its target, jumps only forward and only when it fell more than one delay behind, and eases to a
 * stop at the newest data when the data stops. Reduced motion shows the newest data in 500 ms steps
 * instead (§ M0, superseding the strip's 4 Hz). No allocation: the clock is one object, changed in
 * place.
 */
import type { DisplayClock } from "./types";

/**
 * With no new data for this long, ms, the clock has eased to a stop and the loop idles.
 */
export const STALE_AFTER_MS = 2000;

/**
 * Reduced motion: the right edge moves to the newest data at most once per this many ms.
 */
export const REDUCED_STEP_MS = 500;

/**
 * The delay until two arrivals were measured, ms.
 */
const START_DELAY_MS = 1000;

/**
 * The shortest delay, ms: one window read of perf (4 Hz).
 */
const MIN_DELAY_MS = 250;

/**
 * The longest delay, ms.
 */
const MAX_DELAY_MS = 1500;

/**
 * The weight of a new gap in the smoothed arrival interval and in its smoothed deviation.
 */
const GAP_GAIN = 0.25;

/**
 * How many smoothed deviations of the gaps the delay keeps beyond the smoothed interval.
 */
const DEVIATIONS = 4;

/**
 * The jitter margin the delay keeps beyond the gaps and their deviation, ms: the right edge stays
 * this far behind the newest data when the next answer comes on time.
 */
const MARGIN_MS = 150;

/**
 * A gap longer than this is a pause (Render hidden, the game stopped), not the arrival interval.
 */
const PAUSE_MS = 2 * MAX_DELAY_MS;

/**
 * The largest speed-up of the clock toward its target: catching up is never more than 5 % fast.
 */
const TRIM_FAST = 0.05;

/**
 * The largest slow-down of the clock toward its target: a longer delay is reached at 10 % slower,
 * so the buffer grows before the next long gap.
 */
const TRIM_SLOW = 0.1;

/**
 * The distance to the target, ms, at which the trim is at its largest; nearer, it shrinks with it.
 */
const TRIM_SPAN_MS = 500;

/**
 * The time constant of the ease at the newest data, ms: closer to it than about a frame's worth of
 * this, the clock slows down exponentially instead of stopping dead.
 */
const EASE_MS = 50;

/**
 * Nearer to the newest data than this, ms, the clock lands on it.
 */
const LAND_MS = 1;

/**
 * The least share of a plot's span kept when the delay is cut off it.
 */
const MIN_SPAN_SHARE = 0.5;

/**
 * Makes a display clock: not started, no arrival, the starting delay.
 *
 * @returns The clock.
 * @example
 * ```ts
 * createDisplayClock().delayMs; // 1000
 * ```
 */
export function createDisplayClock(): DisplayClock {
  return {
    ms: undefined,
    at: 0,
    gapMs: undefined,
    gapDevMs: 0,
    delayMs: START_DELAY_MS,
    cutMs: START_DELAY_MS,
    endMs: undefined,
    arrivedAt: undefined,
    stepMs: undefined,
    stepAt: 0
  };
}

/**
 * Starts the clock over: not started, no arrival, no gap measured, the starting delay (a source
 * switch, a reloaded game, a stopped loop).
 *
 * @param clock - The clock.
 */
export function resetDisplayClock(clock: DisplayClock): void {
  clock.ms = undefined;
  clock.at = 0;
  clock.gapMs = undefined;
  clock.gapDevMs = 0;
  clock.delayMs = START_DELAY_MS;
  clock.cutMs = START_DELAY_MS;
  clock.endMs = undefined;
  clock.arrivedAt = undefined;
  clock.stepMs = undefined;
  clock.stepAt = 0;
}

/**
 * Takes an arrival of new data (an answer of the frames poll): the gap since the previous arrival
 * goes into the smoothed interval and its deviation, and the delay becomes the interval, four
 * deviations and the margin, within 250 to 1500 ms; the first arrival and a pause measure nothing.
 * The newest data's end and the arrival time are kept for `liveEnd`.
 *
 * @param clock - The clock.
 * @param endMs - Source-clock ms of the newest frame's end.
 * @param at - `performance.now()` of the arrival.
 */
export function noteArrival(clock: DisplayClock, endMs: number, at: number): void {
  const previousAt = clock.arrivedAt;
  clock.endMs = endMs;
  clock.arrivedAt = at;
  if (previousAt === undefined) return;
  const gap = at - previousAt;
  if (gap <= 0 || gap > PAUSE_MS) return;
  if (clock.gapMs === undefined) {
    // The first gap: its deviation is taken as half of it until more gaps are seen.
    clock.gapMs = gap;
    clock.gapDevMs = gap / 2;
  } else {
    clock.gapDevMs += GAP_GAIN * (Math.abs(gap - clock.gapMs) - clock.gapDevMs);
    clock.gapMs += GAP_GAIN * (gap - clock.gapMs);
  }
  const delay = clock.gapMs + DEVIATIONS * clock.gapDevMs + MARGIN_MS;
  clock.delayMs = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delay));
}

/**
 * The trim of a rate toward a distance: the distance over 500 ms, at most 5 % up and 10 % down.
 *
 * @param distance - How far the value is behind where it should be, ms (negative: ahead).
 * @returns The share to add to the rate.
 */
function trimOf(distance: number): number {
  return Math.min(TRIM_FAST, Math.max(-TRIM_SLOW, distance / TRIM_SPAN_MS));
}

/**
 * Sets the clock on its target, never past the newest data, and the cut on the delay (the first
 * frame, a jump forward, a new timeline).
 *
 * @param clock - The clock.
 * @param target - Where the clock should be, ms.
 * @param endMs - The newest data's end, ms.
 * @returns The clock's new time, ms.
 */
function placeClock(clock: DisplayClock, target: number, endMs: number): number {
  const placed = Math.min(target, endMs);
  clock.ms = placed;
  clock.cutMs = clock.delayMs;
  return placed;
}

/**
 * Steps the clock to `now` and returns the right edge's time. The target is the newest data's end
 * plus the time since it arrived, less the delay. The first step, data of a new timeline (the newest
 * data older than the clock: a reloaded game) and a clock more than one delay behind its target (a
 * pause, a hidden tab) place it on the target: the only jump, and never backward within one
 * timeline. Otherwise it runs at real time trimmed toward the target, and eases to a stop at the
 * newest data when the data stops. The cut (the time cut off a plot's left, `displaySpan`) follows
 * the delay at the same trimmed pace as the clock's lag, and never less than the clock's distance to
 * the newest data.
 *
 * @param clock - The clock.
 * @param endMs - The newest data's end, source-clock ms.
 * @param arrivedAt - `performance.now()` when it arrived.
 * @param now - `performance.now()` of this frame.
 * @returns Source-clock ms of the right edge.
 * @example
 * ```ts
 * stepDisplayClock(createDisplayClock(), 46_000, 1000, 1000); // 45 000: one starting delay behind
 * ```
 */
export function stepDisplayClock(
  clock: DisplayClock,
  endMs: number,
  arrivedAt: number,
  now: number
): number {
  const target = endMs + (now - arrivedAt) - clock.delayMs;
  const shown = clock.ms;
  const elapsed = Math.max(0, now - clock.at);
  clock.at = now;
  // The first frame, a new timeline, or a clock more than one delay behind: on the target.
  if (shown === undefined || shown > endMs || target - shown > clock.delayMs) {
    return placeClock(clock, target, endMs);
  }

  // Real time, trimmed toward the target; near the newest data an exponential ease to a stop.
  const headroom = endMs - shown;
  const run = elapsed * (1 + trimOf(target - shown));
  const ease = headroom * (1 - Math.exp(-elapsed / EASE_MS));
  const advance = Math.max(0, Math.min(run, ease));
  const next = headroom - advance < LAND_MS ? endMs : shown + advance;
  clock.ms = next;
  // The cut moves like the clock's lag: toward the delay at the same trimmed pace.
  clock.cutMs = Math.max(clock.cutMs - elapsed * trimOf(clock.cutMs - clock.delayMs), endMs - next);
  return next;
}

/**
 * The right edge of every live graph now (the view's end while live): the display clock stepped to
 * `now`, a measured delay behind the newest data. Under reduced motion, the newest data itself,
 * taken at most once per REDUCED_STEP_MS (500 ms steps, no delay).
 *
 * @param clock - The clock.
 * @param now - `performance.now()` of this frame.
 * @param reduced - The person asked for reduced motion.
 * @returns Source-clock ms of the right edge; undefined before the first arrival.
 * @example
 * ```ts
 * const clock = createDisplayClock();
 * noteArrival(clock, 46_000, 1000);
 * liveEnd(clock, 1000, false); // 45 000: one starting delay behind
 * liveEnd(clock, 1000, true); // 46 000: the newest data, in 500 ms steps
 * ```
 */
export function liveEnd(clock: DisplayClock, now: number, reduced: boolean): number | undefined {
  const { endMs, arrivedAt } = clock;
  if (endMs === undefined || arrivedAt === undefined) return undefined;
  if (!reduced) return stepDisplayClock(clock, endMs, arrivedAt, now);
  if (clock.stepMs === undefined || now - clock.stepAt >= REDUCED_STEP_MS) {
    clock.stepMs = endMs;
    clock.stepAt = now;
  }
  return clock.stepMs;
}

/**
 * The time a plot spans: its span less the clock's cut, so its left edge sits at or after the
 * oldest data the window holds; at least half the span.
 *
 * @param clock - The clock.
 * @param windowSpan - The data's `endMs − startMs`, ms.
 * @returns ms.
 * @example
 * ```ts
 * displaySpan(createDisplayClock(), 6000); // 5000
 * ```
 */
export function displaySpan(clock: DisplayClock, windowSpan: number): number {
  return Math.max(windowSpan - clock.cutMs, windowSpan * MIN_SPAN_SHARE);
}
