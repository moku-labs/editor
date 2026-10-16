import { beforeEach, describe, expect, it } from "vitest";
import {
  createDisplayClock,
  displaySpan,
  liveEnd,
  noteArrival,
  REDUCED_STEP_MS,
  resetDisplayClock
} from "../../view/clock";
import type { DisplayClock } from "../../view/types";

// ─────────────────────────────────────────────────────────────────────────────
// view/clock.ts (spec 09 Amendment 2026-10-16, § M11, moved by RV0 from the
// device strip with its tests): every live graph draws at a display clock that
// runs at real time a playout delay behind the newest data (a jitter buffer),
// so the right edge never stands still between two arrivals of the frames feed
// (about 1 Hz). Reduced motion steps every 500 ms at the newest data (§ M0).
// The arrivals and the animation frames are played by hand: `at` is the
// performance.now() of each, the game clock is GAME_ZERO plus the elapsed time.
// ─────────────────────────────────────────────────────────────────────────────

/** One animation frame, ms. */
const FRAME_MS = 16;

/** The game page's clock when the test starts: the data ends at it plus the elapsed time. */
const GAME_ZERO = 100_000;

/** The span a plot shows of the data (the strip's 6 s window). */
const WINDOW_MS = 6000;

/** The delay before two arrivals were measured (spec 09 Amendment 2026-10-16, item 2). */
const START_DELAY_MS = 1000;

/**
 * One painted frame: when, its right edge, the clock's target (the newest data's end plus the time
 * since it arrived, less the delay), the plot's span, and the data it painted.
 */
type Shot = {
  readonly at: number;
  readonly now: number;
  readonly target: number;
  readonly span: number;
  readonly startMs: number;
  readonly endMs: number;
};

let clock: DisplayClock;
let shots: Shot[];
let elapsed: number;

/**
 * Paints one frame at `at`: steps the clock and keeps what the frame shows.
 *
 * @param at - performance.now() of the frame.
 * @param reduced - Reduced motion.
 */
function paint(at: number, reduced: boolean): void {
  const now = liveEnd(clock, at, reduced);
  const { endMs, arrivedAt } = clock;
  if (now === undefined || endMs === undefined || arrivedAt === undefined) return;
  shots.push({
    at,
    now,
    target: endMs + (at - arrivedAt) - clock.delayMs,
    span: displaySpan(clock, WINDOW_MS),
    startMs: endMs - WINDOW_MS,
    endMs
  });
}

/**
 * Plays the arrivals (elapsed ms, ascending) with one frame every 16 ms until `untilMs`: an
 * arrival lands at its own time, between two frames. Frames are painted only while `painting`.
 *
 * @param arrivals - When each answer arrives.
 * @param untilMs - Elapsed ms of the last frame.
 * @param options - The game clock at the start, reduced motion, whether frames are painted.
 * @param options.zero - The game clock at the test's start.
 * @param options.reduced - Reduced motion.
 * @param options.painting - Frames are painted (false: a hidden tab).
 */
function play(
  arrivals: readonly number[],
  untilMs: number,
  { zero = GAME_ZERO, reduced = false, painting = true } = {}
): void {
  let index = arrivals.findIndex(at => at > elapsed);
  if (index < 0) index = arrivals.length;
  while (elapsed + FRAME_MS <= untilMs) {
    const next = elapsed + FRAME_MS;
    for (let at = arrivals[index]; at !== undefined && at <= next; at = arrivals[index]) {
      noteArrival(clock, zero + at, at);
      index += 1;
    }
    elapsed = next;
    if (painting) paint(next, reduced);
  }
}

/**
 * The right edge's advance from each painted frame to the next, ms.
 *
 * @param list - The frames.
 * @returns One advance per pair.
 */
function advances(list: readonly Shot[]): number[] {
  return list.slice(1).map((shot, index) => shot.now - (list[index]?.now ?? shot.now));
}

/**
 * Arrival times from a list of gaps, the first at 0.
 *
 * @param gaps - ms between two arrivals.
 * @returns Elapsed ms of each arrival.
 */
function arrivalsOf(gaps: readonly number[]): number[] {
  const times = [0];
  for (const gap of gaps) times.push((times.at(-1) ?? 0) + gap);
  return times;
}

beforeEach(() => {
  clock = createDisplayClock();
  shots = [];
  elapsed = -1;
});

describe("the display clock (spec 09 Amendment 2026-10-16, § M11)", () => {
  it("a 1 Hz arrival stream advances the right edge every frame by about the frame's time, never backwards, never past the newest data", () => {
    play(arrivalsOf(Array.from({ length: 20 }, () => 1000)), 20_000);

    expect(shots.length).toBeGreaterThan(1000);
    expect(Math.min(...advances(shots))).toBeGreaterThan(0);
    // From the second arrival on the delay is measured: each frame moves by its own time, ± a trim.
    const settled = advances(shots.filter(shot => shot.at > 1000));
    expect(Math.min(...settled)).toBeGreaterThanOrEqual(FRAME_MS * 0.85);
    expect(Math.max(...settled)).toBeLessThanOrEqual(FRAME_MS * 1.15);
    expect(shots.every(shot => shot.now <= shot.endMs)).toBe(true);
    // The delay shrinks as the steady gaps are seen, and the plot gets the time back on its left.
    const spans = shots.map(shot => shot.span);
    expect(spans.at(-1) ?? 0).toBeGreaterThan(Math.min(...spans) + 100);
  });

  it("jittered arrivals (0.7–1.4 s) never freeze once the delay has adapted", () => {
    const arrivals = arrivalsOf([
      700, 700, 1400, 700, 1400, 1400, 700, 1400, 1000, 700, 1400, 1400, 900, 700, 1400
    ]);
    play(arrivals, arrivals.at(-1) ?? 0);

    // Before it adapted (the starting delay, then a buffer growing at a trimmed pace) a 1.4 s gap
    // may still run dry; from the fifth arrival on none does.
    expect(Math.min(...advances(shots))).toBeGreaterThanOrEqual(0);
    const adapted = advances(shots.filter(shot => shot.at > (arrivals[4] ?? 0)));
    expect(adapted.length).toBeGreaterThan(400);
    expect(Math.min(...adapted)).toBeGreaterThanOrEqual(FRAME_MS * 0.85);
    expect(shots.every(shot => shot.now <= shot.endMs)).toBe(true);
  });

  it("a plot's left edge never runs before the oldest data: its span is the data's less the delay", () => {
    play(arrivalsOf([700, 1400, 1000, 1000, 1300, 800, 1000, 1000, 1000, 1000]), 10_200);

    expect(shots.length).toBeGreaterThan(500);
    expect(shots.every(shot => shot.now - shot.span >= shot.startMs - 1e-6)).toBe(true);
    // The span is cut by the delay (250 to 1500 ms), not more: the scale does not zoom in.
    expect(Math.min(...shots.map(shot => shot.span))).toBeGreaterThanOrEqual(WINDOW_MS - 1600);
    expect(Math.max(...shots.map(shot => shot.span))).toBeLessThanOrEqual(WINDOW_MS - 250);
  });

  it("when the data stops, the right edge eases to a stop exactly at the newest data", () => {
    play(arrivalsOf([1000, 1000, 1000, 1000, 1000]), 5100);
    play([], 5000 + 2500);

    const endMs = GAME_ZERO + 5000;
    expect(shots.at(-1)?.now).toBe(endMs);
    expect(shots.every(shot => shot.now <= endMs)).toBe(true);
    const steps = advances(shots.filter(shot => shot.at > 5000));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    // A soft landing: the last moves shrink one after the other, the landing itself under 1.5 ms.
    const moving = steps.filter(step => step > 0);
    const easing = moving.slice(-6, -1);
    expect(easing).toEqual(easing.toSorted((a, b) => b - a));
    expect(easing.at(-1) ?? FRAME_MS).toBeLessThan(FRAME_MS * 0.25);
    expect(moving.at(-1) ?? FRAME_MS).toBeLessThan(1.5);
  });

  it("a hidden tab coming back jumps the right edge forward onto its place, never backward", () => {
    const arrivals = arrivalsOf(Array.from({ length: 12 }, () => 1000));
    play(arrivals, 3000);
    const before = shots.at(-1)?.now ?? 0;
    play(arrivals, 8000, { painting: false });
    const hidden = shots.length;
    play(arrivals, 9000);

    const back = shots.slice(hidden);
    expect(back.length).toBeGreaterThan(30);
    expect(back[0]?.now ?? 0).toBeGreaterThan(before + 4000);
    // On its target: one delay behind the newest data, not run on through the time it was hidden.
    expect(back[0]?.now).toBeCloseTo(back[0]?.target ?? 0, 6);
    expect(back.every(shot => shot.now <= shot.endMs)).toBe(true);
    expect(Math.min(...advances(shots))).toBeGreaterThan(0);
    expect(Math.max(...advances(back))).toBeLessThanOrEqual(FRAME_MS * 1.15);
  });

  it("data of a new timeline (a reloaded game, older than the clock) is placed on its target, one delay behind", () => {
    play(arrivalsOf([1000, 1000, 1000]), 3000);
    shots = [];

    // The reloaded game's clock is far behind the old one; the poll keeps arriving.
    const zero = 50_000;
    play([3001], 3400, { zero });

    const first = shots.find(shot => shot.at > 3001);
    expect(first?.now).toBeCloseTo(first?.target ?? 0, 6);
    expect(first?.now ?? GAME_ZERO).toBeLessThan(zero + 3001);
  });

  it("a reset (a source switch) starts over at the starting delay and knows no data", () => {
    play(arrivalsOf([1000, 1000, 1000]), 3000);
    resetDisplayClock(clock);
    shots = [];

    expect(liveEnd(clock, 3010, false)).toBeUndefined();
    const zero = 50_000;
    play([3001], 3400, { zero });

    const first = shots.find(shot => shot.at > 3001);
    expect(first).toBeDefined();
    const since = (first?.at ?? 0) - 3001;
    expect(first?.now).toBeCloseTo(zero + 3001 + since - START_DELAY_MS, 6);
  });

  it("reduced motion shows the newest data in 500 ms steps, not the strip's 4 Hz", () => {
    // The data arrives at 4 Hz, as the strip's window did.
    play(arrivalsOf(Array.from({ length: 16 }, () => 250)), 4000, { reduced: true });

    const changes = shots.filter((shot, index) => shot.now !== shots[index - 1]?.now);
    expect(changes.length).toBeGreaterThan(5);
    const intervals = changes.slice(1).map((shot, index) => shot.at - (changes[index]?.at ?? 0));
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(REDUCED_STEP_MS);
    expect(Math.max(...intervals)).toBeLessThan(REDUCED_STEP_MS + FRAME_MS);
    // At the newest data, no delay.
    expect(changes.every(shot => shot.now === shot.endMs)).toBe(true);
  });
});

describe("noteArrival", () => {
  it("a pause (Render hidden, the game stopped) is not an arrival gap: the delay stays", () => {
    noteArrival(clock, 1000, 0);
    noteArrival(clock, 2000, 1000);
    noteArrival(clock, 3000, 2000);
    const delay = clock.delayMs;

    noteArrival(clock, 13_000, 12_000);

    expect(clock.delayMs).toBe(delay);
    expect(clock.gapMs).toBe(1000);
    expect(clock.endMs).toBe(13_000);
  });
});
