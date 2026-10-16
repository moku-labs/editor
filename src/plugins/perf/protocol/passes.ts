/**
 * @file perf/protocol — the GPU passes of a second (spec 03 Delta 2026-10-16 D5): the wire value of
 * `editor.perf.passes`, its filter chains and the heaviest frame's pass list, and the pure helpers
 * that build them (filter chains, the GPU share of a pass, the tile-GPU test). Runtime-free. The
 * helpers are typed stubs until build wave 1 (unit A).
 */
import type { PassKind, PerfHeaderLine } from "./engine";
import type { PerfPassRowsWire } from "./frames";

/**
 * Pass rows the agent's pass window keeps per frame of its window: the engine ring's own bound
 * (4 passes per frame of capacity, TC §2.1).
 */
export const PASS_ROWS_PER_FRAME = 4;

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
 * The GPU passes of the newest full second, and the heaviest drawn frame's pass list. `gpuMs` of a
 * pass on a tile GPU (Mali, Adreno, Apple, PowerVR) is a share of the frame, never a ranking:
 * `tiler: true` tells the reader to show `share` (TC §1e).
 *
 * @example
 * ```ts
 * const passes: PerfPassesWire = { v: 1, source: "agent", t: 81000, frames: 60, tiler: true, gpuTimer: true,
 *   chains: [{ owner: 412, view: "fogLayer", kinds: ["fog.blur", "fog.blur"], applies: 120, mpx: 221.2, draws: 4,
 *     gpuMs: { p50: 6.2, max: 6.9 }, share: 0.6 }],
 *   heaviest: { frame: 4852, passes: [{ index: 0, kind: "canvas", view: "main", owner: null, filter: null, w: 1080, h: 2340,
 *     format: "bgra8unorm", resolution: 2.6, draws: 41, gpuMs: 3.1, share: 0.3 }] },
 *   shaders: null, targets: { created: 6, destroyed: 6 }, lost: 0 };
 * ```
 */
export type PerfPassesWire = {
  v: 1;
  /** "engine": the engine's `passes` line as sent (next change); "agent": perf aggregated its pass window (0.15.x). */
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
 * Throws the "not built" error of a stubbed function: build wave 1 (unit A) replaces each stub.
 *
 * @param name - The function.
 * @throws {Error} `[moku-editor] perf/protocol.<name> is not built yet.\n  It lands in build wave 1.`
 */
function notBuilt(name: string): never {
  throw new Error(
    `[moku-editor] perf/protocol.${name} is not built yet.\n  It lands in build wave 1.`
  );
}

/**
 * The filter chains of pass rows (D5): consecutive filter passes of one frame (`row`) with the same
 * owner, or without owners the same view, in index order, aggregated over the rows' frames. Pure;
 * allocates its answer only.
 *
 * @param _rows - The pass rows of the second.
 * @returns The chains, heaviest first.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.chainsOf is not built yet.`
 */
export function chainsOf(_rows: PerfPassRowsWire): PassChainSummary[] {
  return notBuilt("chainsOf");
}

/**
 * Whether the page's GPU is a tile GPU: `header.gpu.vendor`, `architecture` or `renderer` names arm,
 * mali, qualcomm, adreno, apple, imagination or powervr (a case-insensitive word match). False for
 * null.
 *
 * @param _gpu - The header's gpu, or null.
 * @returns True for a tile GPU.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.isTilerGpu is not built yet.`
 */
export function isTilerGpu(_gpu: PerfHeaderLine["gpu"] | null): boolean {
  return notBuilt("isTilerGpu");
}

/**
 * A pass's share of its frame's summed pass GPU ms, rounded to 0.05 (one cell of the UI); null
 * without a measured frame GPU.
 *
 * @param _passMs - The pass's GPU ms.
 * @param _frameMs - The frame's summed pass GPU ms.
 * @returns The share, 0 to 1, or null.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.gpuShare is not built yet.`
 */
export function gpuShare(_passMs: number, _frameMs: number): number | null {
  return notBuilt("gpuShare");
}
