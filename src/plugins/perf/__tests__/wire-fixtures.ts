/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
/**
 * @file Builders of the Mission control wire values for the protocol tests (spec 03 Delta
 * 2026-10-16 D9, D5): a frames wire from plain rows (absolute page-clock times, systems by name)
 * and the pass rows of a wire. Test infrastructure, imported by relative path.
 */
import type {
  PassKind,
  PerfFramesWire,
  PerfPassRowsWire,
  PerfSystemsWire,
  RestState
} from "../protocol";

/** One frame row of a test wire; `t` is page-clock ms (the builder subtracts `t0`). */
export type WireRow = {
  frame: number;
  t?: number;
  ms?: number;
  jsMs?: number;
  gpuMs?: number | null;
  drawn?: 0 | 1;
  rest?: RestState;
  causes?: number;
  noise?: number;
  draws?: number | null;
  nodes?: number;
  /** The row's top systems, name and ms, at most 5. */
  systems?: readonly (readonly [string, number])[];
};

/** One pass row of a test wire; `row` indexes the wire's frame rows. */
export type WirePass = {
  row: number;
  index: number;
  kind?: PassKind;
  view?: string | null;
  owner?: number | null;
  filter?: string | null;
  w?: number;
  h?: number;
  format?: string | null;
  resolution?: number | null;
  draws?: number | null;
  gpuMs?: number | null;
};

/** What a test wire carries besides its rows. */
export type WireOptions = {
  epoch?: string | null;
  hole?: boolean;
  gpuTimer?: boolean;
  /** Adds the `draws` column. */
  draws?: boolean;
  /** Adds the `systems` block (from each row's `systems`). */
  systems?: boolean;
  /** Adds the `nodes` column. */
  nodes?: boolean;
  passes?: readonly WirePass[];
};

/** The epoch of the test page. */
export const EPOCH = "1792000000000.5";

/**
 * Consecutive frame rows from `first`, `stepMs` apart, starting at page-clock `t`.
 *
 * @param first - The first frame number.
 * @param count - Rows.
 * @param t - Page-clock ms of the first row.
 * @param stepMs - ms between rows.
 * @param extra - Fields every row gets.
 * @returns The rows.
 */
export function runOf(
  first: number,
  count: number,
  t = 80_000,
  stepMs = 10,
  extra: Omit<WireRow, "frame" | "t"> = {}
): WireRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ...extra,
    frame: first + index,
    t: t + index * stepMs
  }));
}

/**
 * The systems block of rows: names by first appearance, idx and ms rows × 5 (−1 / 0 for none).
 *
 * @param rows - The rows.
 * @returns The block.
 */
function systemsOf(rows: readonly WireRow[]): PerfSystemsWire {
  const names: string[] = [];
  const idx: number[] = [];
  const ms: number[] = [];
  for (const row of rows) {
    const systems = row.systems ?? [];
    for (let slot = 0; slot < 5; slot += 1) {
      const system = systems[slot];
      if (system === undefined) {
        idx.push(-1);
        ms.push(0);
        continue;
      }
      if (!names.includes(system[0])) names.push(system[0]);
      idx.push(names.indexOf(system[0]));
      ms.push(system[1]);
    }
  }
  return { names, idx, ms };
}

/**
 * The pass rows block of a wire.
 *
 * @param passes - The passes.
 * @returns The block.
 */
export function passRowsOf(passes: readonly WirePass[]): PerfPassRowsWire {
  return {
    row: passes.map(pass => pass.row),
    index: passes.map(pass => pass.index),
    kind: passes.map(pass => pass.kind ?? "canvas"),
    view: passes.map(pass => pass.view ?? null),
    owner: passes.map(pass => pass.owner ?? null),
    filter: passes.map(pass => pass.filter ?? null),
    w: passes.map(pass => pass.w ?? 1080),
    h: passes.map(pass => pass.h ?? 2340),
    format: passes.map(pass => pass.format ?? null),
    resolution: passes.map(pass => pass.resolution ?? null),
    draws: passes.map(pass => pass.draws ?? null),
    gpuMs: passes.map(pass => pass.gpuMs ?? null)
  };
}

/**
 * A frames wire of the rows: `t0` is the first row's time, every `t` relative to it.
 *
 * @param rows - The rows, oldest first.
 * @param options - Epoch, hole, the optional blocks.
 * @returns The wire.
 */
export function framesWire(rows: readonly WireRow[], options: WireOptions = {}): PerfFramesWire {
  const t0 = rows[0]?.t ?? 0;
  const wire: PerfFramesWire = {
    v: 1,
    epoch: options.epoch === undefined ? EPOCH : options.epoch,
    t0,
    hole: options.hole ?? false,
    gpuTimer: options.gpuTimer ?? true,
    frame: rows.map(row => row.frame),
    t: rows.map(row => (row.t ?? t0) - t0),
    ms: rows.map(row => row.ms ?? 9),
    jsMs: rows.map(row => row.jsMs ?? 8),
    gpuMs: rows.map(row => (row.gpuMs === undefined ? 1 : row.gpuMs)),
    rateMs: rows.map(() => 8.33),
    budgetMs: rows.map(() => 8.33),
    drawn: rows.map(row => row.drawn ?? 1),
    rest: rows.map(row => row.rest ?? 0),
    causes: rows.map(row => row.causes ?? 0),
    noise: rows.map(row => row.noise ?? 0)
  };
  if (options.draws === true) wire.draws = rows.map(row => row.draws ?? null);
  if (options.systems === true) wire.systems = systemsOf(rows);
  if (options.nodes === true) wire.nodes = rows.map(row => row.nodes ?? 0);
  if (options.passes !== undefined) wire.passes = passRowsOf(options.passes);
  return wire;
}
