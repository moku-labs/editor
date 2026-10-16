/**
 * @file renderView device strip — the playout clock of the strip's graph (spec 09 Amendment
 * 2026-10-16): like a video jitter buffer, the graph is drawn at a display clock that runs at real
 * time and sits behind the newest row by a playout delay, so the right edge keeps moving between two
 * `editor.perf.window` arrivals (about 1 Hz). The delay follows the measured arrival interval; the
 * clock is trimmed softly toward its target, jumps only forward and only when it fell more than one
 * delay behind, and eases to a stop at the newest row when the data stops. No allocation: the clock
 * is one object, changed in place.
 */
import type { PlayoutClock } from "./types";

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
 * this far behind the newest row when the next window comes on time.
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
 * The time constant of the ease at the newest row, ms: closer to it than about a frame's worth of
 * this, the clock slows down exponentially instead of stopping dead.
 */
const EASE_MS = 50;

/**
 * Nearer to the newest row than this, ms, the clock lands on it.
 */
const LAND_MS = 1;

/**
 * The least share of the window's span the plot keeps when the delay is cut off it.
 */
const MIN_SPAN_SHARE = 0.5;

/**
 * Makes the playout clock of a strip: not started, the starting delay.
 *
 * @returns The clock.
 * @example
 * ```ts
 * createPlayout().delayMs; // 1000
 * ```
 */
export function createPlayout(): PlayoutClock {
  return {
    ms: undefined,
    at: 0,
    gapMs: undefined,
    gapDevMs: 0,
    delayMs: START_DELAY_MS,
    cutMs: START_DELAY_MS
  };
}

/**
 * Starts the clock over: not started, no gap measured, the starting delay (cleared data, a stopped
 * loop).
 *
 * @param clock - The clock.
 */
export function resetPlayout(clock: PlayoutClock): void {
  clock.ms = undefined;
  clock.at = 0;
  clock.gapMs = undefined;
  clock.gapDevMs = 0;
  clock.delayMs = START_DELAY_MS;
  clock.cutMs = START_DELAY_MS;
}

/**
 * Takes the arrival of a window into the delay: the gap since the previous arrival goes into the
 * smoothed interval and its deviation, and the delay becomes the interval, four deviations and the
 * margin, within 250 to 1500 ms. The first arrival and a pause measure nothing.
 *
 * @param clock - The clock.
 * @param previousAt - `performance.now()` of the previous arrival; undefined for the first.
 * @param at - `performance.now()` of this arrival.
 */
export function notePlayoutArrival(
  clock: PlayoutClock,
  previousAt: number | undefined,
  at: number
): void {
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
 * Sets the clock on its target, never past the newest row, and the cut on the delay (the first
 * frame, a jump forward, a new timeline).
 *
 * @param clock - The clock.
 * @param target - Where the clock should be, ms.
 * @param endMs - The newest row's end, ms.
 * @returns The clock's new time, ms.
 */
function placePlayout(clock: PlayoutClock, target: number, endMs: number): number {
  const placed = Math.min(target, endMs);
  clock.ms = placed;
  clock.cutMs = clock.delayMs;
  return placed;
}

/**
 * Steps the clock to `now` and returns the right edge's time. The target is the newest row's end
 * plus the time since its window arrived, less the delay. The first step, data of a new timeline
 * (the newest row older than the clock: a reloaded game) and a clock more than one delay behind its
 * target (a pause, a hidden tab) place it on the target: the only jump, and never backward within one
 * timeline. Otherwise it runs at real time trimmed toward the target, and eases to a stop at the
 * newest row when the data stops. The plot's cut (the time cut off its left, `playoutSpan`) follows
 * the delay at the same trimmed pace as the clock's lag, and never less than the clock's distance to
 * the newest row, so the plot's left edge never runs before the window's oldest row.
 *
 * @param clock - The clock.
 * @param endMs - The newest row's end, page-clock ms of the game.
 * @param windowAt - `performance.now()` when its window arrived.
 * @param now - `performance.now()` of this frame.
 * @returns Page-clock ms of the plot's right edge.
 * @example
 * ```ts
 * stepPlayout(createPlayout(), 46_000, 1000, 1000); // 45 000: one starting delay behind
 * ```
 */
export function stepPlayout(
  clock: PlayoutClock,
  endMs: number,
  windowAt: number,
  now: number
): number {
  const target = endMs + (now - windowAt) - clock.delayMs;
  const shown = clock.ms;
  const elapsed = Math.max(0, now - clock.at);
  clock.at = now;
  // The first frame, a new timeline, or a clock more than one delay behind: on the target.
  if (shown === undefined || shown > endMs || target - shown > clock.delayMs) {
    return placePlayout(clock, target, endMs);
  }

  // Real time, trimmed toward the target; near the newest row an exponential ease to a stop.
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
 * The time the plot spans: the window's span less the clock's cut, so the left edge sits at or after
 * the window's oldest row; at least half the window.
 *
 * @param clock - The clock.
 * @param windowSpan - The window's `endMs − startMs`, ms.
 * @returns ms.
 * @example
 * ```ts
 * playoutSpan(createPlayout(), 6000); // 5000
 * ```
 */
export function playoutSpan(clock: PlayoutClock, windowSpan: number): number {
  return Math.max(windowSpan - clock.cutMs, windowSpan * MIN_SPAN_SHARE);
}
