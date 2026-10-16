/**
 * @file perf/protocol — the GPU passes of a second (spec 03 Delta 2026-10-16 D5): the wire value of
 * `editor.perf.passes`, its filter chains and the heaviest frame's pass list, and the pure helpers
 * that build them (filter chains, the GPU share of a pass, the tile-GPU test). Runtime-free.
 */
import type { PassKind, PerfHeaderLine } from "./engine";
import type { PerfPassRowsWire } from "./frames";

/**
 * Pass rows the agent's pass window keeps per frame of its window: the engine ring's own bound
 * (4 passes per frame of capacity, TC §2.1).
 */
export const PASS_ROWS_PER_FRAME = 4;

/**
 * The pass kinds the editor knows, in the order the tools page's history stores them as a byte
 * (`PerfHistory.passKind`): the engine's `PassKind` union. A type-level test fails when the engine
 * adds a kind this list does not have (`readFramesWire` refuses a kind it does not know).
 */
export const PASS_KINDS = ["canvas", "texture", "filter"] as const satisfies readonly PassKind[];

/**
 * One pass of a frame as the passes panel lists it: `gpuMs` is the pass's own reading; `share` is its
 * part of the frame's summed pass GPU (the number a tile GPU shows), null without a GPU timer.
 *
 * @example
 * ```ts
 * const pass: PassRowWire = { index: 0, kind: "canvas", view: "main", owner: null, filter: null, w: 1080, h: 2340,
 *   format: "bgra8unorm", resolution: 2.6, draws: 41, gpuMs: 3.1, share: 0.3 };
 * ```
 */
export type PassRowWire = {
  index: number;
  kind: PassKind;
  view: string | null;
  owner: number | null;
  filter: string | null;
  w: number;
  h: number;
  format: string | null;
  resolution: number | null;
  draws: number | null;
  gpuMs: number | null;
  share: number | null;
};

/**
 * One filter chain over a second: consecutive filter passes of one frame with the same owner (or,
 * without owners, the same label), their interned kind names in order, applies, megapixels, draws,
 * GPU ms over the frames and the chain's mean share of the frame's pass GPU.
 *
 * @example
 * ```ts
 * const chain: PassChainSummary = { owner: 412, view: "fogLayer", kinds: ["fog.blur", "fog.blur"], applies: 120, mpx: 221.2, draws: 4,
 *   gpuMs: { p50: 6.2, max: 6.9 }, share: 0.6 };
 * ```
 */
export type PassChainSummary = {
  owner: number | null;
  view: string | null;
  kinds: string[];
  applies: number;
  mpx: number;
  draws: number | null;
  gpuMs: { p50: number; max: number } | null;
  share: number | null;
};

/**
 * The GPU passes of a second as the passes panel shows them, and the heaviest drawn frame's pass
 * list: what `passesSummaryOf` builds on the tools page from an `editor.perf.passes` answer. `gpuMs`
 * of a pass on a tile GPU (Mali, Adreno, Apple, PowerVR) is a share of the frame, never a ranking:
 * `tiler: true` tells the reader to show `share` (TC §1e).
 *
 * @example
 * ```ts
 * const passes: PerfPassesSummary = { v: 1, source: "agent", t: 81000, frames: 60, tiler: true, gpuTimer: true,
 *   chains: [{ owner: 412, view: "fogLayer", kinds: ["fog.blur", "fog.blur"], applies: 120, mpx: 221.2, draws: 4,
 *     gpuMs: { p50: 6.2, max: 6.9 }, share: 0.6 }],
 *   heaviest: { frame: 4852, passes: [{ index: 0, kind: "canvas", view: "main", owner: null, filter: null, w: 1080, h: 2340,
 *     format: "bgra8unorm", resolution: 2.6, draws: 41, gpuMs: 3.1, share: 0.3 }] },
 *   shaders: null, targets: { created: 6, destroyed: 6 }, lost: 0 };
 * ```
 */
export type PerfPassesSummary = {
  v: 1;
  /** "engine": from the engine's `passes` line (next change); "agent": from perf's pass rows (0.15.x). */
  source: "engine" | "agent";
  /** Page-clock ms of the end of the second. */
  t: number;
  /** Drawn frames in the second. */
  frames: number;
  tiler: boolean;
  gpuTimer: boolean;
  chains: PassChainSummary[];
  heaviest: { frame: number; passes: PassRowWire[] } | null;
  /** sample.shaders of the second (next change); null before. */
  shaders: {
    pipelines: number;
    hits: number;
    compiles: number;
    variants: number;
    relinks: number;
  } | null;
  /** sample.targets (0.15.x patch); null before. */
  targets: { created: number; destroyed: number } | null;
  /** Passes the engine's ring overwrote before perf read them, since start. */
  lost: number;
};

/**
 * The engine's per-second `passes` line (N4, next change) as the wire carries it: the line's chains
 * and heaviest frame, arrays plain (Json).
 *
 * @example
 * ```ts
 * const line: PassesLineWire = { t: 1_792_000_081_000, heaviest: null,
 *   chains: [{ owner: 412, view: "fogLayer", kinds: ["fog.blur"], applies: 60, mpx: 37.9, draws: 1, gpuMs: { p50: 3, max: 3.4 } }] };
 * ```
 */
export type PassesLineWire = {
  t: number;
  chains: {
    owner: number | null;
    view: string | null;
    kinds: string[];
    applies: number;
    mpx: number;
    draws: number | null;
    gpuMs: { p50: number; max: number } | null;
  }[];
  heaviest: {
    frame: number;
    passes: {
      index: number;
      kind: PassKind;
      label: string | null;
      stencil: boolean | null;
      w: number;
      h: number;
      gpuMs: number | null;
    }[];
  } | null;
};

/**
 * The wire value of `editor.perf.passes` (owner 2026-10-16: the agent sends raw rows, the tools
 * page builds the chains): the newest full second, either the pass rows perf read of its drawn
 * frames and its heaviest drawn frame (`source: "agent"`, 0.15.x), or the engine's own `passes` line
 * as it came (`source: "engine"`, next change). `passesSummaryOf` turns it into the panel's summary.
 *
 * @example
 * ```ts
 * const wire: PerfPassesWire = { v: 1, source: "agent", t: 81000, frames: 60, tiler: true, gpuTimer: true,
 *   rows: { row: [0], index: [0], kind: ["canvas"], view: ["main"], owner: [null], filter: [null], w: [1080], h: [2340],
 *     format: [null], resolution: [null], draws: [41], gpuMs: [3.1] },
 *   heaviest: { frame: 4852, row: 0 }, line: null, shaders: null, targets: { created: 6, destroyed: 6 }, lost: 0 };
 * ```
 */
export type PerfPassesWire = {
  v: 1;
  source: "engine" | "agent";
  /** Page-clock ms of the end of the second. */
  t: number;
  /** Drawn frames in the second. */
  frames: number;
  tiler: boolean;
  gpuTimer: boolean;
  /** source "agent": the pass rows of the second, `row` the index of the frame among its frames; null for "engine". */
  rows: PerfPassRowsWire | null;
  /** source "agent": the heaviest drawn frame and its row among the second's frames; null when none. */
  heaviest: { frame: number; row: number } | null;
  /** source "engine": the engine's `passes` line as sent; null for "agent". */
  line: PassesLineWire | null;
  /** sample.shaders of the second (next change); null before. */
  shaders: PerfPassesSummary["shaders"];
  /** sample.targets (0.15.x patch); null before. */
  targets: PerfPassesSummary["targets"];
  /** Passes the engine's ring overwrote before perf read them, since start. */
  lost: number;
};

/**
 * How a chain walk reads pass rows in order, whatever stores them (a wire's columns, the history's
 * interned columns): the frame each row belongs to, its index, whether it is a filter pass, its
 * owner (0: none) and its view (compared with `===`).
 *
 * @example
 * ```ts
 * const reader: ChainReader = { count: rows.row.length, frame: pass => rows.row[pass] ?? -1, index: pass => rows.index[pass] ?? -1,
 *   isFilter: pass => rows.kind[pass] === "filter", owner: pass => rows.owner[pass] ?? 0, view: pass => rows.view[pass] ?? null };
 * ```
 */
export type ChainReader = {
  readonly count: number;
  frame(pass: number): number;
  index(pass: number): number;
  isFilter(pass: number): boolean;
  owner(pass: number): number;
  view(pass: number): number | string | null;
};

/** One chain of a second, while chainsOf sums it. */
type ChainSum = {
  readonly owner: number | null;
  readonly view: string | null;
  readonly kinds: string[];
  applies: number;
  mpx: number;
  draws: number;
  drawnFrames: number;
  readonly gpu: number[];
  readonly shares: number[];
};

/** Megapixels in a pixel. */
const MEGA = 1e-6;

/** Steps of a share: 0.05, one cell of the UI. */
const SHARE_STEPS = 20;

/** Rounding of a chain's megapixels (0.1) and GPU ms (0.01). */
const MPX_SCALE = 10;
const MS_SCALE = 100;

/** The p50 of a chain's GPU ms over its frames. */
const P50 = 0.5;

/** A word that names a tile GPU's vendor, architecture or renderer (TC §1e). */
const TILER_WORDS = /\b(?:arm|mali|qualcomm|adreno|apple|imagination|powervr)\b/i;

/**
 * Whether pass `pass` continues the chain of pass `previous` (D5): the same frame, the next index,
 * and the same owner, or without owners the same view.
 *
 * @param reader - The pass rows.
 * @param previous - The pass before, a filter pass.
 * @param pass - This pass, a filter pass.
 * @returns Whether both are one chain.
 * @example
 * ```ts
 * continuesChain(reader, 1, 2); // true for two fog.blur passes of owner 412 at indexes 1 and 2
 * ```
 */
function continuesChain(reader: ChainReader, previous: number, pass: number): boolean {
  if (reader.frame(pass) !== reader.frame(previous)) return false;
  if (reader.index(pass) !== reader.index(previous) + 1) return false;
  const owner = reader.owner(pass);
  return (
    owner === reader.owner(previous) && (owner !== 0 || reader.view(pass) === reader.view(previous))
  );
}

/**
 * Walks pass rows in order and calls `visit` once per filter chain (D5): consecutive filter passes
 * of one frame with the same owner (or, without owners, the same view) at consecutive indexes; a
 * pass of another kind ends a chain. Allocates nothing itself.
 *
 * @param reader - The pass rows.
 * @param visit - Called with the chain's first pass and the pass after its last.
 * @example
 * ```ts
 * walkChains(reader, (first, end) => console.info(end - first)); // 3 for fog.blur, fog.blur, colorMatrix of owner 412
 * ```
 */
export function walkChains(reader: ChainReader, visit: (first: number, end: number) => void): void {
  let first = -1;
  for (let pass = 0; pass < reader.count; pass += 1) {
    if (!reader.isFilter(pass)) {
      if (first >= 0) visit(first, pass);
      first = -1;
    } else if (first < 0) {
      first = pass;
    } else if (!continuesChain(reader, pass - 1, pass)) {
      visit(first, pass);
      first = pass;
    }
  }
  if (first >= 0) visit(first, reader.count);
}

/**
 * The chain reader of a wire's pass rows.
 *
 * @param rows - The pass rows.
 * @returns The reader.
 * @example
 * ```ts
 * wireReader(rows).isFilter(1); // true when rows.kind[1] is "filter"
 * ```
 */
function wireReader(rows: PerfPassRowsWire): ChainReader {
  return {
    count: rows.row.length,
    frame: pass => rows.row[pass] ?? -1,
    index: pass => rows.index[pass] ?? -1,
    isFilter: pass => rows.kind[pass] === "filter",
    owner: pass => rows.owner[pass] ?? 0,
    // eslint-disable-next-line unicorn/no-null -- null is "no view label"
    view: pass => rows.view[pass] ?? null
  };
}

/**
 * The summed measured GPU ms of each frame row's passes; NaN for a row without one.
 *
 * @param rows - The pass rows.
 * @returns GPU ms by frame row.
 * @example
 * ```ts
 * frameGpuOf(rows).get(0); // 9: a 2 ms canvas and a 7 ms chain
 * ```
 */
function frameGpuOf(rows: PerfPassRowsWire): Map<number, number> {
  const sums = new Map<number, number>();
  for (const [pass, row] of rows.row.entries()) {
    const gpu = rows.gpuMs[pass];
    if (typeof gpu === "number") sums.set(row, (sums.get(row) ?? 0) + gpu);
  }
  return sums;
}

/**
 * The sum of a column over the passes of one chain, or NaN when a pass is not measured.
 *
 * @param column - The column.
 * @param first - The chain's first pass.
 * @param end - The pass after its last.
 * @returns The sum, or NaN.
 * @example
 * ```ts
 * sumOf([2, null], 0, 2); // NaN
 * ```
 */
function sumOf(column: readonly (number | null)[], first: number, end: number): number {
  let sum = 0;
  for (let pass = first; pass < end; pass += 1) sum += column[pass] ?? Number.NaN;
  return sum;
}

/**
 * Adds one chain of one frame to its sum over the second, keyed by owner, view and kinds.
 *
 * @param sums - The second's chains by key.
 * @param rows - The pass rows.
 * @param range - The chain's first pass and the pass after its last.
 * @param range.first - The first pass.
 * @param range.end - The pass after the last.
 * @param frameGpu - The frames' summed pass GPU ms.
 */
function addChain(
  sums: Map<string, ChainSum>,
  rows: PerfPassRowsWire,
  { first, end }: { first: number; end: number },
  frameGpu: Map<number, number>
): void {
  // eslint-disable-next-line unicorn/no-null -- null is "no owner" / "no view label"
  const owner = rows.owner[first] ?? null;
  // eslint-disable-next-line unicorn/no-null -- as above
  const view = rows.view[first] ?? null;
  const kinds = rows.filter.slice(first, end).map(name => name ?? "filter");
  const key = [owner, view, ...kinds].join("\u0000");
  const sum = sums.get(key) ?? {
    owner,
    view,
    kinds,
    applies: 0,
    mpx: 0,
    draws: 0,
    drawnFrames: 0,
    gpu: [],
    shares: []
  };
  sums.set(key, sum);

  sum.applies += end - first;
  for (let pass = first; pass < end; pass += 1) {
    sum.mpx += (rows.w[pass] ?? 0) * (rows.h[pass] ?? 0) * MEGA;
  }
  const draws = sumOf(rows.draws, first, end);
  if (Number.isFinite(draws)) {
    sum.draws += draws;
    sum.drawnFrames += 1;
  }
  const gpu = sumOf(rows.gpuMs, first, end);
  if (!Number.isFinite(gpu)) return;
  sum.gpu.push(gpu);
  const frameMs = frameGpu.get(rows.row[first] ?? -1) ?? 0;
  if (frameMs > 0) sum.shares.push(gpu / frameMs);
}

/**
 * The summary of a chain's sum: megapixels to 0.1, draws per frame, GPU p50 and max over its
 * frames, its mean share rounded to 0.05.
 *
 * @param sum - The chain's sum over the second.
 * @returns The summary.
 * @example
 * ```ts
 * summaryOf(sum).gpuMs; // { p50: 3, max: 7 } over frames of 2, 3 and 7 ms
 * ```
 */
function summaryOf(sum: ChainSum): PassChainSummary {
  const sorted = sum.gpu.toSorted((one, other) => one - other);
  const p50 = sorted[Math.ceil(sorted.length * P50) - 1];
  const max = sorted.at(-1);
  const meanShare = sum.shares.reduce((total, share) => total + share, 0) / sum.shares.length;
  // eslint-disable-next-line unicorn/no-null -- null is "not measured": no draw count, no GPU timer
  const none = null;
  return {
    owner: sum.owner,
    view: sum.view,
    kinds: sum.kinds,
    applies: sum.applies,
    mpx: Math.round(sum.mpx * MPX_SCALE) / MPX_SCALE,
    draws: sum.drawnFrames === 0 ? none : Math.round(sum.draws / sum.drawnFrames),
    gpuMs:
      p50 === undefined || max === undefined
        ? none
        : {
            p50: Math.round(p50 * MS_SCALE) / MS_SCALE,
            max: Math.round(max * MS_SCALE) / MS_SCALE
          },
    share: sum.shares.length === 0 ? none : gpuShare(meanShare, 1)
  };
}

/**
 * The GPU ms a chain's sum ranks by: its frames' GPU summed; −1 without a GPU timer.
 *
 * @param sum - The chain's sum.
 * @returns The rank.
 * @example
 * ```ts
 * weightOf(sum); // 12 for frames of 2, 3 and 7 ms
 * ```
 */
function weightOf(sum: ChainSum): number {
  return sum.gpu.length === 0 ? -1 : sum.gpu.reduce((total, ms) => total + ms, 0);
}

/**
 * The filter chains of pass rows (D5): consecutive filter passes of one frame (`row`) with the same
 * owner, or without owners the same view, in index order (`walkChains`), summed over the rows'
 * frames by owner, view and kinds: `kinds` the filter names (an unnamed filter of an engine before
 * the patch is "filter"), `applies` the passes, `mpx` w × h / 1e6 summed, `draws` per frame (null
 * without a draw count), `gpuMs` p50 and max over the frames (null without a GPU timer), `share` the
 * mean of the chain's part of its frame's summed pass GPU, rounded to 0.05. Heaviest first (GPU, then
 * megapixels). Pure; allocates its answer.
 *
 * @param rows - The pass rows of the second.
 * @returns The chains, heaviest first.
 * @example
 * ```ts
 * chainsOf(rows)[0]?.kinds; // ["fog.blur", "fog.blur", "colorMatrix"]: owner 412's filters, one chain
 * ```
 */
export function chainsOf(rows: PerfPassRowsWire): PassChainSummary[] {
  const sums = new Map<string, ChainSum>();
  const frameGpu = frameGpuOf(rows);
  walkChains(wireReader(rows), (first, end) => addChain(sums, rows, { first, end }, frameGpu));
  return [...sums.values()]
    .toSorted((one, other) => weightOf(other) - weightOf(one) || other.mpx - one.mpx)
    .map(sum => summaryOf(sum));
}

/**
 * Whether the page's GPU is a tile GPU: `header.gpu.vendor`, `architecture` or `renderer` names arm,
 * mali, qualcomm, adreno, apple, imagination or powervr (a case-insensitive word match, so "Mali-G68"
 * is one and "charming" is not). False for null. On a tile GPU a pass's own GPU ms is a share of
 * the frame, never a ranking (TC §1e).
 *
 * @param gpu - The header's gpu, or null.
 * @returns True for a tile GPU.
 * @example
 * ```ts
 * isTilerGpu({ backend: "webgpu", vendor: "arm", architecture: "valhall", renderer: null, timer: "timestamp-query" }); // true
 * ```
 */
export function isTilerGpu(gpu: PerfHeaderLine["gpu"] | null): boolean {
  if (gpu === null) return false;
  return [gpu.vendor, gpu.architecture, gpu.renderer].some(
    text => typeof text === "string" && TILER_WORDS.test(text)
  );
}

/**
 * A pass's share of its frame's summed pass GPU ms, within 0..1 and rounded to 0.05 (one cell of the
 * UI); null without a measured frame GPU.
 *
 * @param passMs - The pass's GPU ms.
 * @param frameMs - The frame's summed pass GPU ms.
 * @returns The share, 0 to 1, or null.
 * @example
 * ```ts
 * gpuShare(1, 3); // 0.35
 * ```
 */
export function gpuShare(passMs: number, frameMs: number): number | null {
  // eslint-disable-next-line unicorn/no-null -- null is "no GPU timer": no share to show
  if (!Number.isFinite(passMs) || !Number.isFinite(frameMs) || frameMs <= 0) return null;
  const share = Math.min(1, Math.max(0, passMs / frameMs));
  return Math.round(share * SHARE_STEPS) / SHARE_STEPS;
}

/**
 * Adds each pass's share of the list's summed GPU ms (rounded to 0.05, null without a GPU time).
 *
 * @param list - One frame's passes, without their share.
 * @returns The passes with their share.
 * @example
 * ```ts
 * withShares([canvasPass, blurPass]).map(pass => pass.share); // [0.25, 0.75] for 2 ms and 6 ms
 * ```
 */
function withShares(list: readonly Omit<PassRowWire, "share">[]): PassRowWire[] {
  let frameMs = 0;
  for (const pass of list) frameMs += pass.gpuMs ?? 0;
  return list.map(pass => ({ ...pass, share: gpuShare(pass.gpuMs ?? Number.NaN, frameMs) }));
}

/**
 * The passes of one frame of pass rows, as the passes panel lists them.
 *
 * @param rows - The pass rows.
 * @param row - The frame's row among them.
 * @returns The frame's passes, with their shares.
 * @example
 * ```ts
 * passListOf(rows, 0)[0]?.kind; // "canvas"
 * ```
 */
function passListOf(rows: PerfPassRowsWire, row: number): PassRowWire[] {
  // eslint-disable-next-line unicorn/no-null -- null is "not measured" in a pass row
  const none = null;
  const list: Omit<PassRowWire, "share">[] = [];
  for (const [pass, at] of rows.row.entries()) {
    if (at !== row) continue;
    list.push({
      index: rows.index[pass] ?? 0,
      kind: rows.kind[pass] ?? "canvas",
      view: rows.view[pass] ?? none,
      owner: rows.owner[pass] ?? none,
      filter: rows.filter[pass] ?? none,
      w: rows.w[pass] ?? 0,
      h: rows.h[pass] ?? 0,
      format: rows.format[pass] ?? none,
      resolution: rows.resolution[pass] ?? none,
      draws: rows.draws[pass] ?? none,
      gpuMs: rows.gpuMs[pass] ?? none
    });
  }
  return withShares(list);
}

/**
 * The summary of the engine's `passes` line: its chains as sent (no share: the engine sends none),
 * its heaviest frame's passes with their shares.
 *
 * @param line - The line.
 * @returns The chains and the heaviest frame.
 * @example
 * ```ts
 * lineSummary(line).chains[0]?.share; // null
 * ```
 */
function lineSummary(line: PassesLineWire): Pick<PerfPassesSummary, "chains" | "heaviest"> {
  // eslint-disable-next-line unicorn/no-null -- null is "not measured": the engine sends no share
  const none = null;
  const { heaviest } = line;
  const passes = (heaviest?.passes ?? []).map(record => ({
    index: record.index,
    kind: record.kind,
    view: record.label,
    owner: none,
    filter: none,
    w: record.w,
    h: record.h,
    format: none,
    resolution: none,
    draws: none,
    gpuMs: record.gpuMs
  }));
  return {
    chains: line.chains.map(chain => ({ ...chain, kinds: [...chain.kinds], share: none })),
    heaviest: heaviest ? { frame: heaviest.frame, passes: withShares(passes) } : none
  };
}

/**
 * The passes panel's summary of an `editor.perf.passes` answer (the tools page's side of D5): the
 * engine's line as sent when the agent passed one on, else the filter chains of the agent's pass rows
 * (`chainsOf`) and the heaviest drawn frame's passes with their GPU shares; the second's facts as
 * they came. Pure; allocates its answer.
 *
 * @param wire - An `editor.perf.passes` answer.
 * @returns The summary.
 * @example
 * ```ts
 * passesSummaryOf(wire).chains[0]?.kinds; // ["fog.blur", "fog.blur"]
 * ```
 */
export function passesSummaryOf(wire: PerfPassesWire): PerfPassesSummary {
  const { v, source, t, frames, tiler, gpuTimer, shaders, targets, lost } = wire;
  const fields = { v, source, t, frames, tiler, gpuTimer, shaders, targets, lost };
  if (wire.line !== null) return { ...fields, ...lineSummary(wire.line) };
  const { rows, heaviest } = wire;
  return {
    ...fields,
    chains: rows === null ? [] : chainsOf(rows),
    heaviest:
      heaviest === null || rows === null
        ? // eslint-disable-next-line unicorn/no-null -- null is "no drawn frame in the second"
          null
        : { frame: heaviest.frame, passes: passListOf(rows, heaviest.row) }
  };
}
