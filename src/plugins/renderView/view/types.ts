/**
 * @file renderView view — the types of Mission control's view (spec 09 § M11): the span, a frame
 * range, live or paused, and the playout-delay display clock every live graph scrolls on.
 */

/**
 * The span of the view: 6 s, 30 s or the whole 2-minute history.
 *
 * @example
 * ```ts
 * const span: MissionSpan = 30_000;
 * ```
 */
export type MissionSpan = 6000 | 30_000 | 120_000;

/**
 * A range of frames, both ends inclusive.
 *
 * @example
 * ```ts
 * const range: FrameRange = { from: 4810, to: 4860 };
 * ```
 */
export type FrameRange = { readonly from: number; readonly to: number };

/**
 * The view: live (its end follows the display clock every frame) or paused at `endMs` (source
 * clock), and its span.
 *
 * @example
 * ```ts
 * const view: MissionViewState = { live: false, endMs: 78_000, span: 6000 };
 * ```
 */
export type MissionViewState = { live: boolean; endMs: number; span: MissionSpan };

/**
 * The display clock of every live graph (spec 09 Amendment 2026-10-16, moved from the device strip
 * by RV0): like a video jitter buffer, the graphs are drawn at a clock that runs at real time and
 * sits behind the newest data by a playout delay that follows the measured arrival interval of the
 * frames feed. One object, changed in place, never reallocated.
 *
 * @example
 * ```ts
 * const clock: DisplayClock = { ms: 45_120, at: 9031.2, gapMs: 1004, gapDevMs: 12, delayMs: 1202, cutMs: 1198,
 *   endMs: 46_300, arrivedAt: 9010, stepMs: undefined, stepAt: 0 };
 * ```
 */
export type DisplayClock = {
  /** Source-clock ms of the right edge at the last frame; undefined before the first. */
  ms: number | undefined;
  /** `performance.now()` of the last frame. */
  at: number;
  /** The smoothed gap between two arrivals, ms; undefined before two arrivals. */
  gapMs: number | undefined;
  /** The smoothed deviation of the gaps from `gapMs`, ms. */
  gapDevMs: number;
  /** How far the clock sits behind the newest data: 1000 ms before two arrivals, then 250 to 1500 ms. */
  delayMs: number;
  /** The time cut off the left of a plot, ms: the delay, followed at the clock's trimmed pace. */
  cutMs: number;
  /** Source-clock ms of the newest frame's end at the last arrival; undefined before the first. */
  endMs: number | undefined;
  /** `performance.now()` of the last arrival; undefined before the first. */
  arrivedAt: number | undefined;
  /** Reduced motion: the right edge of the current 500 ms step; undefined before the first. */
  stepMs: number | undefined;
  /** Reduced motion: `performance.now()` when the current step was taken. */
  stepAt: number;
};
