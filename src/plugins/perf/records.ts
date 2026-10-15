/* eslint-disable unicorn/no-null -- null is "not measured" / "not known" in every perf value (spec 03) */
/**
 * @file perf plugin — the values the API and the sources hand out: the status, `second()` (frozen),
 * the spike summaries and the spike record of a frame with its one-line `why`. Each call allocates
 * its answer; the window is only read.
 */
import type {
  FrameRecord,
  FrameRing,
  PerfCause,
  PerfEventLine,
  PerfFrameEvent,
  PerfRate,
  PerfSecond,
  PerfSpikeLine,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfStatus,
  RateChange
} from "./protocol";
import {
  causeName,
  causesOf,
  changesOf,
  frameEventOf,
  isRateChange,
  PHASES,
  rateFps,
  rowOfFrame,
  statsOf
} from "./protocol";
import { slotOfFrame } from "./reader";
import type { PerfConfig, PerfState } from "./types";

/**
 * One value of a column; NaN past its end (`noUncheckedIndexedAccess` reads a typed array as
 * possibly undefined).
 *
 * @param column - The column.
 * @param index - The index.
 * @returns The value, or NaN.
 * @example
 * ```ts
 * cell(Float32Array.of(16.5), 0); // 16.5
 * ```
 */
function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/** The budget of an empty window, ms. */
const EMPTY_BUDGET_MS = 16.7;

/** A rate switch counts when two rows' `rateMs` differ by more than this, ms. */
const RATE_EPSILON = 0.01;

/** The path of a frame whose path id the ring does not know. */
const UNKNOWN_PATH = "…";

/**
 * A number rounded to 0.01; null for a value that is not finite.
 *
 * @param value - The number.
 * @returns The rounded number, or null.
 * @example
 * ```ts
 * hundredths(16.666_666_03); // 16.67
 * ```
 */
function hundredths(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/**
 * A number rounded to 0.01; 0 for a value that is not finite.
 *
 * @param value - The number.
 * @returns The rounded number.
 * @example
 * ```ts
 * plain(Number.NaN); // 0
 * ```
 */
function plain(value: number): number {
  return hundredths(value) ?? 0;
}

/**
 * What perf can measure now.
 *
 * @param state - perf's state.
 * @returns A fresh status.
 */
export function statusOf(state: PerfState): PerfStatus {
  if (state.off !== undefined) return { state: "off", reason: state.off };
  if (!state.measuring) return { state: "waiting" };
  return { state: "on", lost: state.lost, gpuTimer: state.window.gpuTimer };
}

/**
 * Whether row `row` starts a rate switch: its `rateMs` differs from the row before.
 *
 * @param state - perf's state.
 * @param row - A row.
 * @returns Whether it is a switch.
 */
function switchesAt(state: PerfState, row: number): boolean {
  const { rateMs } = state.window;
  return row > 0 && Math.abs(cell(rateMs, row) - cell(rateMs, row - 1)) > RATE_EPSILON;
}

/**
 * The kept lines of a ring buffer of lines, oldest first.
 *
 * @param lines - The slots.
 * @param next - Lines received so far.
 * @returns The kept lines in arrival order.
 */
function inArrivalOrder<Line>(lines: readonly (Line | undefined)[], next: number): Line[] {
  const kept: Line[] = [];
  const size = lines.length;
  for (let index = Math.max(0, next - size); index < next; index += 1) {
    const line = lines[index % size];
    if (line !== undefined) kept.push(line);
  }
  return kept;
}

/**
 * The loop's rate as perf knows it: fps of the newest row; mode, reason and display Hz from the
 * newest valid `rate` line, else from the header's `rate`, else null; switches in the window.
 *
 * @param state - perf's state.
 * @returns The rate.
 */
export function rateOf(state: PerfState): PerfRate {
  const { window } = state;
  let switches = 0;
  for (let row = 1; row < window.count; row += 1) if (switchesAt(state, row)) switches += 1;

  let change: RateChange | undefined;
  for (const line of inArrivalOrder(state.rateLines, state.rateLineNext)) {
    if (isRateChange(line.detail)) change = line.detail;
  }
  const fps = window.count > 0 ? rateFps(cell(window.rateMs, window.count - 1)) : null;
  if (change !== undefined) {
    return { fps, mode: change.mode, reason: change.reason, displayHz: change.displayHz, switches };
  }

  const header = state.header?.rate;
  return {
    fps,
    mode: header?.mode ?? null,
    reason: header?.reason ?? null,
    displayHz: header?.displayHz ?? null,
    switches
  };
}

/**
 * `renderer.stats()` read now, frozen with its `kept`; null without a `stats` function or when it
 * threw.
 *
 * @param state - perf's state.
 * @returns The frozen copy, or null.
 */
function renderOf(state: PerfState): PerfSecond["render"] {
  const render = statsOf(state.game);
  if (render === undefined) return null;
  return Object.freeze({
    ...render,
    kept: render.kept === null ? null : Object.freeze({ ...render.kept })
  });
}

/**
 * This second, built once per window version and lines and frozen with its `fps`, `rate`, `render`.
 *
 * @param state - perf's state.
 * @returns The cached or a new frozen PerfSecond.
 */
export function secondOf(state: PerfState): PerfSecond {
  if (state.second !== undefined) return state.second;
  const { window, header } = state;
  const newest = window.count - 1;
  const second: PerfSecond = Object.freeze({
    state: statusOf(state).state,
    fps: Object.freeze({ loop: state.fpsLoop, drawn: state.fpsDrawn }),
    spikes: window.spikeCount,
    budgetMs: newest >= 0 ? plain(cell(window.budgetMs, newest)) : EMPTY_BUDGET_MS,
    rate: Object.freeze(rateOf(state)),
    render: renderOf(state),
    sample: state.sample ?? null,
    display: state.display ?? null,
    device: header?.device ?? null,
    gpu: header?.gpu ?? null,
    build: header?.build ?? null,
    engine: header?.engine ?? null
  });
  state.second = second;
  return second;
}

/**
 * The ring slot that still holds a row's frame, or -1 once it was overwritten.
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 * @param row - The row.
 * @returns The slot, or -1.
 */
function slotOf(state: PerfState, ring: FrameRing | undefined, row: number): number {
  if (ring === undefined) return -1;
  return slotOfFrame(ring, cell(state.rowWritten, row), cell(state.window.frame, row));
}

/**
 * The engine's spike line of a frame, the newest that names it; undefined before it arrived.
 *
 * @param state - perf's state.
 * @param frame - The frame number.
 * @returns The spike line, or undefined.
 */
function detailOf(state: PerfState, frame: number): PerfSpikeLine | undefined {
  return inArrivalOrder(state.spikeLines, state.spikeLineNext).findLast(
    line => line.frame.frame === frame
  );
}

/**
 * The numbers of a spike from its ring slot.
 *
 * @param ring - The frame ring.
 * @param slot - The slot.
 * @returns Phases, counts and changes.
 */
function slotNumbers(ring: FrameRing, slot: number): FrameNumbers {
  const { columns } = ring;
  const applies = hundredths(cell(columns.filterApplies, slot));
  const uploads = hundredths(cell(columns.uploads, slot));
  const phase = slot * PHASES.length;
  return {
    phases: {
      input: plain(cell(columns.phaseMs, phase)),
      animate: plain(cell(columns.phaseMs, phase + 1)),
      layout: plain(cell(columns.phaseMs, phase + 2)),
      sync: plain(cell(columns.phaseMs, phase + 3)),
      signals: plain(cell(columns.phaseMs, phase + 4)),
      render: plain(cell(columns.phaseMs, phase + 5)),
      agent: plain(cell(columns.agentMs, slot))
    },
    passes: hundredths(cell(columns.passes, slot)),
    draws: hundredths(cell(columns.draws, slot)),
    filters: applies === null ? null : { applies, mpx: plain(cell(columns.filterMpx, slot)) },
    uploads: uploads === null ? null : { count: uploads, mb: plain(cell(columns.uploadMb, slot)) },
    compiles: hundredths(cell(columns.compiles, slot)),
    changed: changesOf(cell(columns.changed, slot))
  };
}

/**
 * The numbers of a spike from the engine's frame record (its slot was overwritten).
 *
 * @param record - The frame record of the spike line.
 * @returns Phases, counts and changes.
 */
function recordNumbers(record: FrameRecord): FrameNumbers {
  return {
    phases: { ...record.phases },
    passes: record.passes,
    draws: record.draws,
    filters:
      record.filters === null ? null : { applies: record.filters.applies, mpx: record.filters.mpx },
    uploads: record.uploads === null ? null : { ...record.uploads },
    compiles: record.compiles,
    changed: record.changed.map(change => change.kind)
  };
}

/**
 * The numbers of a spike record that come from the ring slot or the spike line.
 */
type FrameNumbers = Pick<
  PerfSpikeRecord,
  "phases" | "passes" | "draws" | "filters" | "uploads" | "compiles" | "changed"
>;

/** The numbers of a spike whose slot was overwritten before its spike line came. */
const NO_NUMBERS: FrameNumbers = Object.freeze({
  phases: null,
  passes: null,
  draws: null,
  filters: null,
  uploads: null,
  compiles: null,
  changed: Object.freeze([])
});

/**
 * The game's frame events of a frame, in arrival order: its `overlay` and `warm` lines, and the
 * `pool-trim` lines of this frame or the frame before (the frame after a trim pays the
 * re-allocation, engine fact 11).
 *
 * @param state - perf's state.
 * @param frame - The frame number.
 * @returns The frame events.
 */
function eventsOf(state: PerfState, frame: number): PerfFrameEvent[] {
  const lines: PerfEventLine[] = inArrivalOrder(state.frameEvents, state.frameEventNext);
  const events: PerfFrameEvent[] = [];
  for (const line of lines) {
    const event = frameEventOf(line);
    if (event === undefined) continue;
    if (event.frame === frame || (event.kind === "pool-trim" && event.frame === frame - 1)) {
      events.push(event);
    }
  }
  return events;
}

/**
 * Whether a `rate` line written between frames (`frame` null, 11:1056: a `game.frameRate` or
 * `setRate` switch) leads into the switch at `row`: its change goes from the previous row's rate to
 * this row's, and it was written after the previous row started and no later than this one (epoch
 * ms; at any time while there is no header).
 *
 * @param state - perf's state.
 * @param row - A row whose rate differs from the row before.
 * @param line - The rate line.
 * @param change - Its detail.
 * @returns Whether the line explains the switch.
 */
function leadsInto(
  state: PerfState,
  row: number,
  line: PerfEventLine,
  change: RateChange
): boolean {
  const { window, header } = state;
  if (line.frame !== null) return false;
  const from = rateFps(cell(window.rateMs, row - 1));
  if (change.from !== from || change.to !== rateFps(cell(window.rateMs, row))) return false;
  if (header === undefined) return true;
  return (
    line.t > header.timeOrigin + cell(window.t, row - 1) &&
    line.t <= header.timeOrigin + cell(window.t, row)
  );
}

/**
 * The rate switch at a row: the kept `rate` line of its frame, or a frame-null line that leads into
 * the switch (with reason and mode), else the switch the rows show, else null.
 *
 * @param state - perf's state.
 * @param row - The row.
 * @returns The switch, or null.
 */
function rateSwitchOf(state: PerfState, row: number): PerfSpikeRecord["rateSwitch"] {
  const frame = cell(state.window.frame, row);
  const switched = switchesAt(state, row);
  let change: RateChange | undefined;
  for (const line of inArrivalOrder(state.rateLines, state.rateLineNext)) {
    const detail = line.detail;
    if (!isRateChange(detail)) continue;
    if (line.frame === frame || (switched && leadsInto(state, row, line, detail))) change = detail;
  }
  if (change !== undefined) {
    return { from: change.from, to: change.to, reason: change.reason, mode: change.mode };
  }
  if (!switched) return null;
  const { rateMs } = state.window;
  return {
    from: rateFps(cell(rateMs, row - 1)),
    to: rateFps(cell(rateMs, row)),
    reason: null,
    mode: null
  };
}

/**
 * What `whyOf` reads of a spike.
 */
export type WhyFacts = {
  readonly cause: PerfCause;
  readonly ms: number;
  readonly jsMs: number;
  readonly gpuMs: number | null;
  readonly gapMs: number | null;
  readonly budgetMs: number;
  readonly fps: number;
  readonly uploads: { readonly mb: number } | null;
  readonly compiles: number | null;
  readonly gpuTimer: boolean;
  readonly detail: PerfSpikeLine | null;
};

/**
 * A number with one decimal.
 *
 * @param value - The number.
 * @returns The text.
 * @example
 * ```ts
 * fixed(41); // "41.0"
 * ```
 */
function fixed(value: number): string {
  return value.toFixed(1);
}

/**
 * The upload sentence: MB uploaded and, when the detail names a bundle change, the bundle.
 *
 * @param facts - The spike.
 * @returns The sentence.
 */
function uploadWhy(facts: WhyFacts): string {
  const mb = facts.uploads?.mb ?? facts.detail?.frame.uploads?.mb ?? 0;
  const bundle = facts.detail?.frame.changed.find(
    change => change.kind === "bundle" && change.what !== null
  )?.what;
  const subject = bundle === undefined || bundle === null ? "" : ` (bundle ${bundle})`;
  return `${fixed(mb)} MB of textures uploaded this frame${subject}`;
}

/**
 * The compile sentence: how many and, when the detail has one, the first labelled compile.
 *
 * @param facts - The spike.
 * @returns The sentence.
 */
function compileWhy(facts: WhyFacts): string {
  const count = facts.compiles ?? facts.detail?.compiles.length ?? 0;
  const label = facts.detail?.compiles.find(compile => compile.label !== null)?.label;
  const subject = label === undefined || label === null ? "" : ` (${label})`;
  const noun = count === 1 ? "compile" : "compiles";
  return `${Math.round(count)} shader ${noun} on first use this frame${subject}`;
}

/**
 * The long-frame sentence: the longest overlapping long animation frame and its top script.
 *
 * @param facts - The spike.
 * @returns The sentence.
 */
function longFrameWhy(facts: WhyFacts): string {
  const frames = facts.detail?.longFrames ?? [];
  let longest = frames[0];
  for (const entry of frames) if (entry.durationMs > (longest?.durationMs ?? 0)) longest = entry;
  let top = longest?.scripts[0];
  for (const script of longest?.scripts ?? []) if (script.ms > (top?.ms ?? 0)) top = script;
  const name = top === undefined ? "" : top.fn || top.source;
  const subject = name === "" ? "" : ` (${name})`;
  return `A long animation frame overlapped: script held the main thread for ${fixed(longest?.durationMs ?? facts.ms)} ms${subject}`;
}

/**
 * The one sentence of why a spike was late, by its primary cause (numbers with one decimal).
 *
 * @param facts - The spike.
 * @returns The sentence.
 * @example
 * ```ts
 * whyOf({ cause: "js", ms: 21, jsMs: 12.4, gpuMs: null, gapMs: 16.7, budgetMs: 8.33, fps: 120, uploads: null,
 *   compiles: null, gpuTimer: true, detail: null }); // "Work ran 12.4 ms on the main thread, over its 8.3 ms budget (120 fps)"
 * ```
 */
export function whyOf(facts: WhyFacts): string {
  const budget = `${fixed(facts.budgetMs)} ms budget (${facts.fps} fps)`;
  const gap = fixed(facts.gapMs ?? facts.ms);
  switch (facts.cause) {
    case "gpu": {
      return `The GPU needed ${fixed(facts.gpuMs ?? 0)} ms for this frame, over its ${budget}`;
    }
    case "upload": {
      return uploadWhy(facts);
    }
    case "compile": {
      return compileWhy(facts);
    }
    case "longFrame": {
      return longFrameWhy(facts);
    }
    case "js": {
      return `Work ran ${fixed(facts.jsMs)} ms on the main thread, over its ${budget}`;
    }
    case "gc?": {
      return `The loop paused ${gap} ms with no JS work; Chrome hints it was likely GC (a hint, never a certainty)`;
    }
    default: {
      const timer = facts.gpuTimer
        ? ""
        : ". This browser has no GPU timer, so a busy GPU also reads as a gap";
      return `The loop paused ${gap} ms with no JS work: GC, OS or compositor${timer}`;
    }
  }
}

/**
 * What a summary and a record share of a spike row: the ring numbers (or the spike line's once the
 * slot was overwritten) and the spike line itself.
 */
type RowFacts = {
  readonly numbers: FrameNumbers;
  readonly detail: PerfSpikeLine | null;
};

/**
 * The numbers and the detail of a spike row.
 *
 * @param state - perf's state.
 * @param ring - The frame ring, while perf has a monitor.
 * @param row - A spike row.
 * @returns The facts.
 */
function factsOfRow(state: PerfState, ring: FrameRing | undefined, row: number): RowFacts {
  const detail = detailOf(state, cell(state.window.frame, row)) ?? null;
  const slot = slotOf(state, ring, row);
  if (ring !== undefined && slot >= 0) return { numbers: slotNumbers(ring, slot), detail };
  return { numbers: detail === null ? NO_NUMBERS : recordNumbers(detail.frame), detail };
}

/**
 * The summary of one spike row: the window's numbers, the causes, the path and the why. No frame
 * events and no rate switch: those are the record's.
 *
 * @param state - perf's state.
 * @param ring - The frame ring, while perf has a monitor.
 * @param row - A spike row.
 * @param facts - The row's numbers and detail.
 * @returns The summary.
 */
function summaryOfRow(
  state: PerfState,
  ring: FrameRing | undefined,
  row: number,
  facts: RowFacts
): PerfSpikeSummary {
  const { window } = state;
  const ms = plain(cell(window.ms, row));
  const budgetMs = plain(cell(window.budgetMs, row));
  const gpuMs = hundredths(cell(window.gpuMs, row));
  const jsMs = plain(cell(window.jsMs, row));
  const cause = causeName(cell(window.cause, row)) ?? "gap";
  return {
    frame: cell(window.frame, row),
    agoMs: plain(cell(window.t, window.count - 1) - cell(window.t, row)),
    ms,
    budgetMs,
    overMs: plain(ms - budgetMs),
    cause,
    causes: causesOf(cell(window.causes, row)),
    jsMs,
    gpuMs,
    path: ring?.paths[cell(state.rowPath, row)] ?? UNKNOWN_PATH,
    why: whyOf({
      cause,
      ms,
      jsMs,
      gpuMs,
      gapMs: hundredths(cell(state.rowGapMs, row)),
      budgetMs,
      fps: rateFps(cell(window.rateMs, row)),
      uploads: facts.numbers.uploads,
      compiles: facts.numbers.compiles,
      gpuTimer: window.gpuTimer,
      detail: facts.detail
    })
  };
}

/**
 * The record of one spike row: its summary, the epoch time, the rate switch, the numbers, the game's
 * frame events and the detail.
 *
 * @param state - perf's state.
 * @param row - A spike row.
 * @returns The record.
 */
function recordOfRow(state: PerfState, row: number): PerfSpikeRecord {
  const { window, header } = state;
  const ring = state.monitor?.frames();
  const facts = factsOfRow(state, ring, row);
  const summary = summaryOfRow(state, ring, row, facts);
  return {
    ...summary,
    at: header === undefined ? null : plain(header.timeOrigin + cell(window.t, row)),
    fps: rateFps(cell(window.rateMs, row)),
    rateSwitch: rateSwitchOf(state, row),
    gapMs: hundredths(cell(state.rowGapMs, row)),
    drawn: window.drawn[row] === 1,
    gpuPartial: state.rowPartial[row] === 1,
    ...facts.numbers,
    events: eventsOf(state, summary.frame),
    detail: facts.detail
  };
}

/**
 * The record of a spike of the window.
 *
 * @param state - perf's state.
 * @param frame - The frame number.
 * @returns The record; undefined when the frame is not a spike of the window.
 */
export function spikeRecord(state: PerfState, frame: number): PerfSpikeRecord | undefined {
  const row = rowOfFrame(state.window, frame);
  if (row < 0 || state.window.cause[row] === 0) return undefined;
  return recordOfRow(state, row);
}

/**
 * The spikes of the window that started at most `lastMs` before the newest frame, oldest first.
 *
 * @param state - perf's state.
 * @param config - perf's config.
 * @param query - `lastMs`: clamped to 0…windowMs; not a finite number → windowMs.
 * @param query.lastMs - The span, ms.
 * @returns The summaries; [] while off.
 */
export function spikeSummaries(
  state: PerfState,
  config: Readonly<PerfConfig>,
  query?: { readonly lastMs?: number }
): PerfSpikeSummary[] {
  const asked = query?.lastMs;
  const lastMs =
    asked !== undefined && Number.isFinite(asked)
      ? Math.min(Math.max(asked, 0), config.windowMs)
      : config.windowMs;
  const { window } = state;
  const ring = state.monitor?.frames();
  const newestT = cell(window.t, window.count - 1);
  const summaries: PerfSpikeSummary[] = [];
  for (let index = 0; index < window.spikeCount; index += 1) {
    const row = cell(window.spikes, index);
    if (newestT - cell(window.t, row) > lastMs) continue;
    summaries.push(summaryOfRow(state, ring, row, factsOfRow(state, ring, row)));
  }
  return summaries;
}
