/**
 * @file perf feeds — the frames feed (spec 03 Delta 2026-10-16 D9): the window rows after a frame
 * with the per-frame blocks the feeds switched on (draws, the top 5 systems, the demand marks, the
 * pass rows), each frame once; and the system names the systems block indexes, copied only when
 * the ring's names grow.
 */
import type { MonitorSectionName, PerfFramesWire, PerfSystemsWire, RestState } from "../protocol";
import { SYSTEMS_PER_FRAME } from "../protocol";
import type { NamedRing, PerfState } from "../types";
import { passRowsOf } from "./passes";
import { cell, epochOf, MS_SCALE, measured, rounded, TIME_SCALE } from "./wire";

/**
 * A rest column value as one of its four states (anything else is awake).
 *
 * @param value - The column value.
 * @returns The rest state.
 * @example
 * ```ts
 * restOf(3); // 3: a break
 * ```
 */
function restOf(value: number | undefined): RestState {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

/**
 * Whether the engine's section is on as last heard (an engine without sections: on). A section
 * that is off sends no block: absent, never 0 (D7).
 *
 * @param state - perf's state.
 * @param section - The section.
 * @returns Whether it is on.
 */
function isOn(state: PerfState, section: MonitorSectionName): boolean {
  return state.sections?.[section] !== false;
}

/**
 * The top 5 systems of window rows `[first, end)`: the names, and per row five indexes (−1 none)
 * and their ms.
 *
 * @param state - perf's state.
 * @param first - The first window row.
 * @param end - The row after the last.
 * @returns The systems block.
 */
function systemsOf(state: PerfState, first: number, end: number): PerfSystemsWire {
  const indexes: number[] = [];
  const ms: number[] = [];
  for (let at = first * SYSTEMS_PER_FRAME; at < end * SYSTEMS_PER_FRAME; at += 1) {
    indexes.push(cell(state.rowSysIdx, at));
    ms.push(rounded(cell(state.rowSysMs, at), MS_SCALE));
  }
  return { names: [...state.systemNames], idx: indexes, ms };
}

/**
 * A frames wire without rows: the page's epoch, `t0`, the hole flag, the GPU timer and empty frame
 * columns.
 *
 * @param state - perf's state.
 * @param t0 - Page-clock ms the rows' `t` are relative to.
 * @param hole - Frames are missing before the first row.
 * @returns The wire.
 */
export function emptyWire(state: PerfState, t0: number, hole: boolean): PerfFramesWire {
  return {
    v: 1,
    epoch: epochOf(state),
    t0,
    hole,
    gpuTimer: state.window.gpuTimer,
    frame: [],
    t: [],
    ms: [],
    jsMs: [],
    gpuMs: [],
    rateMs: [],
    budgetMs: [],
    drawn: [],
    rest: [],
    causes: [],
    noise: []
  };
}

/**
 * The frames wire of window rows `[first, end)` (`t0` the first row's start, `t` after it): the
 * frame columns rounded as the window wire, `draws` when a row counted any, `systems` with
 * `feeds.systems` and the ring's names, `nodes` (−1: not read) with `feeds.nodes`, each only while
 * the engine's section is on, and the pass rows when asked. Allocates its answer.
 *
 * @param state - perf's state.
 * @param range - The rows, whether frames were lost before them, and whether to send the passes.
 * @param range.first - The first window row.
 * @param range.end - The row after the last.
 * @param range.hole - Frames are missing before the first row.
 * @param range.passes - Send the pass rows.
 * @returns The wire.
 */
export function rowsWire(
  state: PerfState,
  range: { first: number; end: number; hole: boolean; passes: boolean }
): PerfFramesWire {
  const { window, feeds } = state;
  const { first, end } = range;
  const t0 = first < end ? rounded(cell(window.t, first), TIME_SCALE) : 0;
  const wire = emptyWire(state, t0, range.hole);
  const draws: (number | null)[] = [];
  const nodes: number[] = [];
  for (let row = first; row < end; row += 1) {
    wire.frame.push(cell(window.frame, row));
    wire.t.push(rounded(cell(window.t, row) - t0, TIME_SCALE));
    wire.ms.push(rounded(cell(window.ms, row), MS_SCALE));
    wire.jsMs.push(rounded(cell(window.jsMs, row), MS_SCALE));
    wire.gpuMs.push(measured(window.gpuMs[row], MS_SCALE));
    wire.rateMs.push(rounded(cell(window.rateMs, row), MS_SCALE));
    wire.budgetMs.push(rounded(cell(window.budgetMs, row), MS_SCALE));
    wire.drawn.push(window.drawn[row] === 1 ? 1 : 0);
    wire.rest.push(restOf(window.rest[row]));
    wire.causes.push(cell(window.causes, row));
    wire.noise.push(cell(window.noise, row));
    draws.push(measured(state.rowDraws[row], 1));
    nodes.push(measured(state.rowMarks[row], 1) ?? -1);
  }
  if (draws.some(count => count !== null)) wire.draws = draws;
  if (feeds.systems && state.caps.systemNames && isOn(state, "systems")) {
    wire.systems = systemsOf(state, first, end);
  }
  if (feeds.nodes && isOn(state, "nodes")) wire.nodes = nodes;
  if (range.passes) wire.passes = passRowsOf(state, first, end);
  return wire;
}

/**
 * `editor.perf.frames { after? }` (D9): the window rows with a frame after `after` (binary search),
 * so each frame crosses the wire once. Without `after`: the whole window. An `after` older than the
 * frame before the window's oldest row answers the whole window with `hole: true` (frames were lost
 * between); one past the newest frame (a reload, a restart) too. Allocates its answer.
 *
 * @param state - perf's state.
 * @param after - The newest frame the reader holds.
 * @returns The wire.
 */
export function framesWireOf(state: PerfState, after?: number): PerfFramesWire {
  const { window } = state;
  const end = window.count;
  let first = 0;
  let hole = false;
  if (after !== undefined) {
    let high = end;
    while (first < high) {
      const middle = (first + high) >> 1;
      if (cell(window.frame, middle) > after) high = middle;
      else first = middle + 1;
    }
    const past = end > 0 && after > cell(window.frame, end - 1);
    if (past) first = 0;
    hole = past || (end > 0 && after < cell(window.frame, 0) - 1);
  }
  return rowsWire(state, { first, end, hole, passes: state.feeds.passes && isOn(state, "passes") });
}

/**
 * Renews the copy of the ring's system names when they grew: a new array (the 0.15.x patch copies
 * on growth) or a longer one (0.15.0 grows the same array). One check per read; the copy only on
 * growth.
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 */
export function noteSystemNames(state: PerfState, ring: NamedRing): void {
  const names = ring.systemNames;
  if (names === undefined) return;
  if (names === state.namesRef && names.length === state.namesLength) return;
  state.namesRef = names;
  state.namesLength = names.length;
  state.systemNames = [...names];
}
