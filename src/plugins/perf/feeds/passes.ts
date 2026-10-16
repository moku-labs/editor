/* eslint-disable unicorn/no-null -- null is "not measured" in every pass value (spec 03 D5) */
/**
 * @file perf feeds — the pass window and `editor.perf.passes` (spec 03 Delta 2026-10-16 D5): the
 * engine's pass ring copied with perf's own cursor inside the read's agent span (indexed loops,
 * allocation-free), trimmed with the frame window, a late pass GPU taken from its own slot only;
 * the pass rows of window rows as a wire; and the newest full second's raw pass rows, or the
 * engine's `passes` line as it came (next change). The chains are built on the tools page
 * (`passesSummaryOf`, owner 2026-10-16), never on the phone.
 */
import type { FrameRing, PerfPassRowsWire } from "../protocol";
import { isTilerGpu, rowOfFrame } from "../protocol";
import { passKindOf } from "../ring";
import type { NamedRing, PassesAnswer, PassRing, PassWindow, PerfState } from "../types";
import { cell, MS_SCALE, measured, TIME_SCALE } from "./wire";

/** A second, ms. */
const SECOND_MS = 1000;

/** Resolution to hundredths. */
const RESOLUTION_SCALE = 100;

/**
 * Drops the oldest `from` rows of the pass window (`copyWithin`, no allocation).
 *
 * @param passes - The pass window.
 * @param from - The first row kept.
 */
function dropPasses(passes: PassWindow, from: number): void {
  const end = passes.count;
  passes.seq.copyWithin(0, from, end);
  passes.frame.copyWithin(0, from, end);
  passes.index.copyWithin(0, from, end);
  passes.kind.copyWithin(0, from, end);
  passes.w.copyWithin(0, from, end);
  passes.h.copyWithin(0, from, end);
  passes.gpuMs.copyWithin(0, from, end);
  passes.label.copyWithin(0, from, end);
  passes.owner?.copyWithin(0, from, end);
  passes.filter?.copyWithin(0, from, end);
  passes.drawsAt?.copyWithin(0, from, end);
  passes.format?.copyWithin(0, from, end);
  passes.resolution?.copyWithin(0, from, end);
  passes.count = end - from;
}

/**
 * Copies the pass of ring index `k` into the next row of the pass window; a full window drops its
 * oldest quarter first.
 *
 * @param passes - The pass window.
 * @param ring - The pass ring.
 * @param k - The ring index of the pass (slot `k % capacity`).
 */
function copyPass(passes: PassWindow, ring: PassRing, k: number): void {
  if (passes.count === passes.capacity) dropPasses(passes, Math.max(1, passes.capacity >> 2));
  const slot = k % ring.capacity;
  const row = passes.count;
  passes.seq[row] = k;
  passes.frame[row] = cell(ring.frame, slot);
  passes.index[row] = cell(ring.index, slot);
  passes.kind[row] = cell(ring.kind, slot);
  passes.w[row] = cell(ring.width, slot);
  passes.h[row] = cell(ring.height, slot);
  passes.gpuMs[row] = cell(ring.gpuMs, slot);
  passes.label[row] = ring.label[slot] ?? null;
  if (passes.owner && ring.owner) passes.owner[row] = cell(ring.owner, slot);
  if (passes.filter && ring.kind2) passes.filter[row] = cell(ring.kind2, slot);
  if (passes.drawsAt && ring.drawsAt) passes.drawsAt[row] = cell(ring.drawsAt, slot);
  if (passes.format && ring.format) passes.format[row] = ring.format[slot] ?? null;
  if (passes.resolution && ring.resolution) passes.resolution[row] = cell(ring.resolution, slot);
  passes.count = row + 1;
}

/**
 * Takes the late GPU time of the passes of window rows whose GPU may still change (`rowPartial`),
 * newest first, while the ring still holds the pass (`written − k ≤ capacity`) and its slot the
 * same frame.
 *
 * @param state - perf's state.
 * @param ring - The pass ring.
 * @returns Whether a pass's GPU changed.
 */
function landPassGpu(state: PerfState, ring: PassRing): boolean {
  const { window, passes, rowPartial } = state;
  let oldest = 0;
  while (oldest < window.count && rowPartial[oldest] !== 1) oldest += 1;
  if (oldest === window.count) return false;
  const since = cell(window.frame, oldest);
  let changed = false;
  for (let row = passes.count - 1; row >= 0 && cell(passes.frame, row) >= since; row -= 1) {
    const frame = cell(passes.frame, row);
    const k = cell(passes.seq, row);
    const slot = k % ring.capacity;
    const held = ring.written - k <= ring.capacity && ring.frame[slot] === frame;
    if (!held || rowPartial[rowOfFrame(window, frame)] !== 1) continue;
    const gpuMs = cell(ring.gpuMs, slot);
    if (Object.is(gpuMs, passes.gpuMs[row])) continue;
    passes.gpuMs[row] = gpuMs;
    changed = true;
  }
  return changed;
}

/**
 * Reads the pass ring into the pass window (D5), inside the read's agent span right after the frame
 * read; nothing while `feeds.passes` is off. From perf's cursor on (at the start or after a
 * switch-on: the ring's oldest held pass), only passes of frames the window holds; a pass of a frame
 * not read yet waits for it. Passes the ring overwrote before this read count as lost; rows older
 * than the window's oldest frame are dropped; a late pass GPU lands from its own slot.
 *
 * @param state - perf's state.
 * @param frames - The frame ring.
 * @returns Whether the pass window changed.
 */
export function readPasses(state: PerfState, frames: FrameRing): boolean {
  const { window, passes } = state;
  const ring: PassRing = frames.passes;
  if (!state.feeds.passes || ring.capacity === 0 || window.count === 0) return false;

  // Where to start: perf's cursor, else the oldest pass the ring holds; an overrun counts as lost.
  const held = ring.written - ring.size;
  let since = state.passCursor ?? held;
  if (since > ring.written) since = held;
  if (since < held) {
    if (state.passCursor !== undefined) state.passesLost += held - since;
    since = held;
  }

  // Copy the passes of the frames the window holds; stop at a frame not read yet.
  const first = cell(window.frame, 0);
  const newest = cell(window.frame, window.count - 1);
  const before = passes.count;
  let k = since;
  for (; k < ring.written; k += 1) {
    const frame = cell(ring.frame, k % ring.capacity);
    if (frame > newest) break;
    if (frame >= first) copyPass(passes, ring, k);
  }
  state.passCursor = k;

  // Trim with the window, then the late GPU times.
  let old = 0;
  while (old < passes.count && cell(passes.frame, old) < first) old += 1;
  if (old > 0) dropPasses(passes, old);
  return landPassGpu(state, ring) || old > 0 || passes.count !== before;
}

/**
 * The filter kind's name of a pass: `kindNames[kind2 - 1]`, null for kind2 0 (no filter).
 *
 * @param names - The frame ring's interned kind names (`FrameRing.kindNames`, not on its passes).
 * @param kind2 - The pass's kind2 byte.
 * @returns The name, or null.
 * @example
 * ```ts
 * filterName(["fog.blur", "colorMatrix"], 2); // "colorMatrix"
 * ```
 */
function filterName(
  names: readonly string[] | undefined,
  kind2: number | undefined
): string | null {
  return kind2 === undefined || kind2 === 0 ? null : (names?.[kind2 - 1] ?? null);
}

/**
 * The draw calls of a pass: the next pass's draw counter minus its own, the last pass of a frame
 * the frame's draws minus its own; null without the draw counter.
 *
 * @param state - perf's state.
 * @param pass - The pass row.
 * @param row - Its frame's window row.
 * @returns The draws, or null.
 */
function passDraws(state: PerfState, pass: number, row: number): number | null {
  const { drawsAt, frame, count } = state.passes;
  if (!state.caps.passDraws || drawsAt === undefined) return null;
  const sameFrame = pass + 1 < count && frame[pass + 1] === frame[pass];
  const next = sameFrame ? cell(drawsAt, pass + 1) : cell(state.rowDraws, row);
  return measured(next - cell(drawsAt, pass), 1);
}

/**
 * Pass rows without a row: twelve empty columns.
 *
 * @returns The pass rows.
 */
function emptyPassRows(): PerfPassRowsWire {
  return {
    row: [],
    index: [],
    kind: [],
    view: [],
    owner: [],
    filter: [],
    w: [],
    h: [],
    format: [],
    resolution: [],
    draws: [],
    gpuMs: []
  };
}

/**
 * Adds one pass of the pass window to pass rows: owner, filter, format and resolution null while
 * the engine does not measure them, draws from the draw counters.
 *
 * @param state - perf's state.
 * @param rows - The pass rows being built.
 * @param pass - The pass window row.
 * @param row - Its frame's window row.
 * @param at - That frame's index among the rows' frames.
 */
function pushPass(
  state: PerfState,
  rows: PerfPassRowsWire,
  pass: number,
  row: number,
  at: number
): void {
  const { passes, caps } = state;
  const ring: NamedRing | undefined = state.monitor?.frames();
  rows.row.push(at);
  rows.index.push(cell(passes.index, pass));
  rows.kind.push(passKindOf(cell(passes.kind, pass)));
  rows.view.push(passes.label[pass] ?? null);
  rows.owner.push(caps.passOwners ? passes.owner?.[pass] || null : null);
  rows.filter.push(caps.passOwners ? filterName(ring?.kindNames, passes.filter?.[pass]) : null);
  rows.w.push(cell(passes.w, pass));
  rows.h.push(cell(passes.h, pass));
  rows.format.push(caps.passFormat ? (passes.format?.[pass] ?? null) : null);
  rows.resolution.push(
    caps.passFormat ? measured(passes.resolution?.[pass], RESOLUTION_SCALE) : null
  );
  rows.draws.push(passDraws(state, pass, row));
  rows.gpuMs.push(measured(passes.gpuMs[pass], MS_SCALE));
}

/**
 * The pass rows of window rows `[first, end)` as a wire: each pass with the index of its frame
 * among those rows; owner, filter, draws, format and resolution null where the engine does not
 * measure them. Allocates its answer.
 *
 * @param state - perf's state.
 * @param first - The first window row.
 * @param end - The row after the last.
 * @returns The pass rows.
 */
export function passRowsOf(state: PerfState, first: number, end: number): PerfPassRowsWire {
  const { window, passes } = state;
  const rows = emptyPassRows();
  let row = first;
  for (let pass = 0; pass < passes.count; pass += 1) {
    const frame = cell(passes.frame, pass);
    while (row < end && cell(window.frame, row) < frame) row += 1;
    if (row === end) break;
    if (cell(window.frame, row) === frame) pushPass(state, rows, pass, row, row - first);
  }
  return rows;
}

/**
 * The window rows of the second that ends at page-clock `end` (`[end − 1000, end)`): its first
 * row, the row after its last, its drawn frames and its heaviest drawn row (−1 for none).
 *
 * @param state - perf's state.
 * @param end - Page-clock ms of the second's end.
 * @returns The rows.
 */
function secondRows(state: PerfState, end: number) {
  const { window } = state;
  let first = 0;
  while (first < window.count && cell(window.t, first) < end - SECOND_MS) first += 1;
  let last = first;
  let drawn = 0;
  let heaviest = -1;
  for (; last < window.count && cell(window.t, last) < end; last += 1) {
    if (window.drawn[last] !== 1) continue;
    drawn += 1;
    if (heaviest < 0 || cell(window.ms, last) > cell(window.ms, heaviest)) heaviest = last;
  }
  return { first, last, drawn, heaviest };
}

/**
 * `editor.perf.passes` (D5; owner 2026-10-16: the tools page builds the chains with
 * `passesSummaryOf`): the newest full second. The engine's newest `passes` line, passed on as it
 * came (source "engine", next change; the wire value copies it); else the pass rows perf read of the
 * newest whole second of the page clock its window covers and that second's heaviest drawn frame
 * (source "agent"). Allocates its answer.
 *
 * @param state - perf's state.
 * @returns The answer; null before the first full second.
 */
export function passesWireOf(state: PerfState): PassesAnswer | null {
  const { window, header, sample } = state;
  const line = state.passesLines[(state.passesLineNext + 1) % 2];
  const t =
    line === undefined
      ? Math.floor(cell(window.t, window.count - 1) / SECOND_MS) * SECOND_MS
      : (measured(line.t - (header?.timeOrigin ?? 0), TIME_SCALE) ?? 0);
  const covered = window.count > 0 && cell(window.t, 0) <= t - SECOND_MS;
  if (line === undefined && !covered) return null;
  const { first, last, drawn, heaviest } = secondRows(state, t);
  const agent = line === undefined;
  return {
    v: 1,
    source: agent ? "agent" : "engine",
    t,
    frames: drawn,
    tiler: isTilerGpu(header?.gpu ?? null),
    gpuTimer: state.caps.gpuTimer,
    rows: agent ? passRowsOf(state, first, last) : null,
    heaviest:
      agent && heaviest >= 0
        ? { frame: cell(window.frame, heaviest), row: heaviest - first }
        : null,
    // eslint-disable-next-line sonarjs/todo-tag -- deferred to the engine's next change (owner 2026-10-16)
    // TODO(engine): the `passes` line (N4) is passed on raw; nothing more is read of it on the phone.
    line: line ?? null,
    shaders: sample?.shaders ?? null,
    targets: sample?.targets ?? null,
    lost: state.passesLost
  };
}
