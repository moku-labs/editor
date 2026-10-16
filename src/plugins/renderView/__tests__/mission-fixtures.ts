/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import type {
  PerfCause,
  PerfEventsWire,
  PerfFramesWire,
  PerfHistory,
  PerfTimelineLine,
  RestState
} from "../source/contract";
import { appendEvents, appendFrames, CAUSE_BITS, createPerfHistory } from "../source/contract";

// ─────────────────────────────────────────────────────────────────────────────
// Builders of Mission control's data for the unit tests of series/, view/,
// timeline/ and derive/: frame rows on the page clock, a frames wire, a filled
// history, and the raw event lines of the events feed (rate, GC, shader,
// problem, mark) as the engine writes them (epoch ms).
// ─────────────────────────────────────────────────────────────────────────────

/** The epoch of the test page (header.timeOrigin as text). */
export const EPOCH = "1792000000000.5";

/** header.timeOrigin: a line's `t` is this plus the page-clock ms. */
export const TIME_ORIGIN = 1_792_000_000_000.5;

/** One frame row; `t` is page-clock ms. */
export type Row = {
  frame: number;
  t: number;
  ms?: number;
  jsMs?: number;
  gpuMs?: number | null;
  rest?: RestState;
  causes?: number;
  budgetMs?: number;
  rateMs?: number;
  drawn?: 0 | 1;
  draws?: number | null;
  nodes?: number;
  systems?: readonly (readonly [string, number])[];
};

/** One pass row of a wire; `row` indexes the wire's frame rows. */
export type PassRow = {
  row: number;
  index: number;
  kind?: "canvas" | "texture" | "filter";
  view?: string | null;
  owner?: number | null;
  filter?: string | null;
  gpuMs?: number | null;
};

/**
 * The cause bits of a list of causes (CAUSE_BITS order).
 *
 * @param causes - The causes.
 * @returns The bits.
 */
export function bitsOf(...causes: readonly PerfCause[]): number {
  let bits = 0;
  for (const cause of causes) bits |= 1 << CAUSE_BITS.indexOf(cause);
  return bits;
}

/**
 * Consecutive rows from `first`, `stepMs` apart from page-clock `t0`; `each` changes a row.
 *
 * @param first - The first frame number.
 * @param count - Rows.
 * @param options - Start time, step and a per-row change.
 * @param options.t0 - Page-clock ms of the first row (10 000 by default).
 * @param options.stepMs - ms between rows (16.67 by default: 60 fps).
 * @param options.each - Extra fields of row `index`.
 * @returns The rows.
 */
export function rowsOf(
  first: number,
  count: number,
  options: { t0?: number; stepMs?: number; each?: (index: number) => Partial<Row> } = {}
): Row[] {
  const t0 = options.t0 ?? 10_000;
  const step = options.stepMs ?? 16.67;
  return Array.from({ length: count }, (_, index) => ({
    frame: first + index,
    t: t0 + index * step,
    ...options.each?.(index)
  }));
}

/**
 * The systems block of rows.
 *
 * @param rows - The rows.
 * @returns names, idx and ms (rows × 5).
 */
function systemsOf(rows: readonly Row[]): { names: string[]; idx: number[]; ms: number[] } {
  const names: string[] = [];
  const idx: number[] = [];
  const ms: number[] = [];
  for (const row of rows) {
    for (let slot = 0; slot < 5; slot += 1) {
      const system = row.systems?.[slot];
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
 * A frames wire of rows (`t0` the first row's time).
 *
 * @param rows - The rows, oldest first.
 * @param options - Epoch, hole, GPU timer, the optional blocks.
 * @param options.epoch - The page's epoch (EPOCH by default).
 * @param options.hole - Frames missing before the first row.
 * @param options.gpuTimer - The page has a GPU timer (true by default).
 * @param options.draws - Adds the draws column.
 * @param options.systems - Adds the systems block.
 * @param options.nodes - Adds the nodes column.
 * @param options.passes - Adds pass rows.
 * @returns The wire.
 */
export function wireOf(
  rows: readonly Row[],
  options: {
    epoch?: string | null;
    hole?: boolean;
    gpuTimer?: boolean;
    draws?: boolean;
    systems?: boolean;
    nodes?: boolean;
    passes?: readonly PassRow[];
  } = {}
): PerfFramesWire {
  const t0 = rows[0]?.t ?? 0;
  const wire: PerfFramesWire = {
    v: 1,
    epoch: options.epoch === undefined ? EPOCH : options.epoch,
    t0,
    hole: options.hole ?? false,
    gpuTimer: options.gpuTimer ?? true,
    frame: rows.map(row => row.frame),
    t: rows.map(row => row.t - t0),
    ms: rows.map(row => row.ms ?? 10),
    jsMs: rows.map(row => row.jsMs ?? 6),
    gpuMs: rows.map(row => (row.gpuMs === undefined ? 3 : row.gpuMs)),
    rateMs: rows.map(row => row.rateMs ?? 16.67),
    budgetMs: rows.map(row => row.budgetMs ?? 16.67),
    drawn: rows.map(row => row.drawn ?? 1),
    rest: rows.map(row => row.rest ?? 0),
    causes: rows.map(row => row.causes ?? 0),
    noise: rows.map(() => 0)
  };
  if (options.draws === true) wire.draws = rows.map(row => row.draws ?? null);
  if (options.systems === true) wire.systems = systemsOf(rows);
  if (options.nodes === true) wire.nodes = rows.map(row => row.nodes ?? 0);
  const passes = options.passes;
  if (passes !== undefined) {
    wire.passes = {
      row: passes.map(pass => pass.row),
      index: passes.map(pass => pass.index),
      kind: passes.map(pass => pass.kind ?? "canvas"),
      view: passes.map(pass => pass.view ?? null),
      owner: passes.map(pass => pass.owner ?? null),
      filter: passes.map(pass => pass.filter ?? null),
      w: passes.map(() => 1280),
      h: passes.map(() => 720),
      format: passes.map(() => null),
      resolution: passes.map(() => null),
      draws: passes.map(() => null),
      gpuMs: passes.map(pass => pass.gpuMs ?? null)
    };
  }
  return wire;
}

/**
 * A history filled with rows (one appendFrames).
 *
 * @param rows - The rows.
 * @param options - wireOf's options.
 * @returns The history.
 */
export function historyOf(
  rows: readonly Row[],
  options: Parameters<typeof wireOf>[1] = {}
): PerfHistory {
  const history = createPerfHistory();
  appendFrames(history, wireOf(rows, options));
  return history;
}

/** Raw event lines of the events feed; `t` is page-clock ms, the line carries epoch ms. */
export const line = {
  /**
   * A rate change.
   *
   * @param t - Page-clock ms.
   * @param frame - The frame, or null between frames.
   * @param from - fps before.
   * @param to - fps after.
   * @param reason - Why.
   * @returns The line.
   */
  rate(
    t: number,
    frame: number | null,
    from: number,
    to: number,
    reason: "missed" | "headroom" | "thermal" | "display" = "missed"
  ): PerfTimelineLine {
    return {
      v: 1,
      kind: "event",
      t: TIME_ORIGIN + t,
      build: null,
      frame,
      name: "rate",
      detail: {
        from,
        to,
        reason,
        mode: "auto",
        displayHz: 120,
        thermal: null,
        window: { drawn: 60, missed: 9, heavy: 0 },
        dwellMs: 5000
      }
    };
  },
  /**
   * A GC.
   *
   * @param t - Page-clock ms.
   * @param frame - The frame.
   * @param freedMb - MB freed.
   * @returns The line.
   */
  gc(t: number, frame: number | null, freedMb: number): PerfTimelineLine {
    return {
      v: 1,
      kind: "event",
      t: TIME_ORIGIN + t,
      build: null,
      frame,
      name: "gc",
      detail: { freedMb, heapMb: 40, hint: false }
    };
  },
  /**
   * A shader compile.
   *
   * @param t - Page-clock ms.
   * @param frame - The frame.
   * @param label - The program.
   * @param ms - How long it took.
   * @param boot - Compiled while loading.
   * @param view - The view it compiled for.
   * @returns The line.
   */
  shader(
    t: number,
    frame: number,
    label: string,
    ms: number,
    boot = false,
    view: string | null = "fogLayer"
  ): PerfTimelineLine {
    return {
      v: 1,
      kind: "event",
      t: TIME_ORIGIN + t,
      build: null,
      frame,
      name: "shader",
      detail: {
        what: "compile",
        label,
        ms,
        frame,
        boot,
        during: { pass: 1, filter: null, owner: 412, view }
      }
    };
  },
  /**
   * A problem flag or clear.
   *
   * @param t - Page-clock ms.
   * @param rule - The rule.
   * @param view - The view it flagged.
   * @param cleared - A clear instead of a flag.
   * @param since - The frame it started at.
   * @returns The line.
   */
  problem(t: number, rule: string, view: string, cleared = false, since = 4802): PerfTimelineLine {
    const detail = cleared
      ? { rule, cleared: true, owner: 412, view }
      : {
          rule,
          severity: "warn",
          owner: 412,
          view,
          filter: "fog.blur",
          value: 6,
          threshold: 2,
          since,
          frames: 53,
          reason: "budget"
        };
    return {
      v: 1,
      kind: "event",
      t: TIME_ORIGIN + t,
      build: null,
      frame: null,
      name: "problem",
      detail
    };
  },
  /**
   * A mark.
   *
   * @param t - Page-clock ms.
   * @param label - Its label.
   * @returns The line.
   */
  mark(t: number, label: string): PerfTimelineLine {
    return { v: 1, kind: "mark", t: TIME_ORIGIN + t, build: null, label, auto: false };
  }
};

/**
 * An events wire of lines, seqs from `firstSeq`.
 *
 * @param lines - The lines, oldest first.
 * @param firstSeq - The first seq.
 * @returns The wire.
 */
export function eventsOf(lines: readonly PerfTimelineLine[], firstSeq = 1): PerfEventsWire {
  return {
    v: 1,
    epoch: EPOCH,
    timeOrigin: TIME_ORIGIN,
    next: firstSeq + lines.length,
    lost: false,
    items: lines.map((entry, index) => ({ seq: firstSeq + index, line: entry }))
  };
}

/**
 * Appends event lines to a history.
 *
 * @param history - The history.
 * @param lines - The lines.
 * @returns The history.
 */
export function withEvents(history: PerfHistory, lines: readonly PerfTimelineLine[]): PerfHistory {
  appendEvents(history, eventsOf(lines, history.eventsNext ?? 1));
  return history;
}
