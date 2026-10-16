/**
 * @file perf/protocol — the frames feed (spec 03 Delta 2026-10-16 D9) and the range detail (D8):
 * the window rows after a frame with the per-frame blocks the feeds switched on, and the wire value
 * of `editor.perf.detail`. Columns are plain arrays (Json). Runtime-free. `readFramesWire` is a typed
 * stub until build wave 1 (unit A).
 */
import type { Json } from "../../registry/protocol";
import type { PassKind } from "./engine";
import type { RestState } from "./window";

/**
 * The systems kept per frame: the engine's top 5 (`sysIdx` / `sysMs` are rows × 5, −1 = none).
 */
export const SYSTEMS_PER_FRAME = 5;

/**
 * The top 5 systems of each frame row: `names` indexes, `idx` and `ms` are rows × 5, −1 = none.
 *
 * @example
 * ```ts
 * const systems: PerfSystemsWire = { names: ["ward.update", "fog.render"], idx: [0, 1, -1, -1, -1], ms: [6.2, 1.4, 0, 0, 0] };
 * ```
 */
export type PerfSystemsWire = { names: string[]; idx: number[]; ms: number[] };

/**
 * Pass rows, flat columns; `row` is the index into the frame columns. Owner / filter / draws / format
 * are null when not measured (an engine before the 0.15.x patch).
 *
 * @example
 * ```ts
 * const passes: PerfPassRowsWire = { row: [0], index: [0], kind: ["canvas"], view: ["main"], owner: [null], filter: [null],
 *   w: [1080], h: [2340], format: ["bgra8unorm"], resolution: [2.6], draws: [41], gpuMs: [3.1] };
 * ```
 */
export type PerfPassRowsWire = {
  row: number[];
  index: number[];
  kind: PassKind[];
  view: (string | null)[];
  owner: (number | null)[];
  filter: (string | null)[];
  w: number[];
  h: number[];
  format: (string | null)[];
  resolution: (number | null)[];
  draws: (number | null)[];
  gpuMs: (number | null)[];
};

/**
 * Window rows after a frame, with the per-frame blocks the feeds switched on (the wire value of
 * `editor.perf.frames { after? }`). Each frame crosses the wire once.
 *
 * @example
 * ```ts
 * const wire: PerfFramesWire = { v: 1, epoch: "1792000000000.5", t0: 80000, hole: false, gpuTimer: true,
 *   frame: [4855], t: [310.2], ms: [18.4], jsMs: [8.1], gpuMs: [9.6], rateMs: [16.67], budgetMs: [16.67], drawn: [1],
 *   rest: [0], causes: [4], noise: [0], draws: [61],
 *   systems: { names: ["ward.update", "fog.render"], idx: [0, 1, -1, -1, -1], ms: [6.2, 1.4, 0, 0, 0] }, nodes: [20] };
 * ```
 */
export type PerfFramesWire = {
  v: 1;
  /** The page's clock origin (header.timeOrigin) as text; a new value means a new page (reload). */
  epoch: string | null;
  /** Page-clock ms every `t` is relative to (the first row's start, rounded to 0.1). */
  t0: number;
  /** True when `after` was older than the oldest row perf still had: frames are missing before `frame[0]`. */
  hole: boolean;
  gpuTimer: boolean;
  frame: number[];
  t: number[];
  ms: number[];
  jsMs: number[];
  gpuMs: (number | null)[];
  rateMs: number[];
  budgetMs: number[];
  drawn: (0 | 1)[];
  rest: RestState[];
  causes: number[];
  noise: number[];
  /** Draw calls per frame (ring `draws`); absent on WebGL (not counted). */
  draws?: (number | null)[];
  /** feeds.systems and caps.systemNames: the top 5 systems per frame. */
  systems?: PerfSystemsWire;
  /** feeds.nodes: demand marks per frame (ring `marks`). */
  nodes?: number[];
  /** feeds.passes: the pass rows of these frames. */
  passes?: PerfPassRowsWire;
};

/**
 * The wire value of `editor.perf.detail { from, to }`: the rows of a range from the engine's
 * `monitor.detail` (next change), else from perf's own window, else none (`reason: "gone"`).
 *
 * @example
 * ```ts
 * const detail: PerfDetailWire = { v: 1, from: 4810, to: 4860, source: "agent", reason: "no-detail", frames: null, nodes: null };
 * ```
 */
export type PerfDetailWire = {
  v: 1;
  from: number;
  to: number;
  /** Where the rows came from; null when none. */
  source: "engine" | "agent" | null;
  /** Why not the engine's detail: no `monitor.detail` (older engine), refused (build without control), failed, or the frames are gone. */
  reason: "no-detail" | "control" | "failed" | "gone" | null;
  frames: PerfFramesWire | null;
  /** Nodes updated or redrawn, from the engine's mark ring (next change); null otherwise. */
  nodes:
    | {
        entity: number;
        label: string | null;
        how: "mark" | "moved" | "loose" | "invalidate" | "redraw";
        count: number;
      }[]
    | null;
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
 * Validates a frames wire value: `v: 1`, equal column lengths, finite numbers, `systems.idx` / `ms`
 * of rows × 5 with indexes inside `names`, pass `row` inside the rows. The tools page drops a value
 * it refuses and warns once.
 *
 * @param _value - The value read from `editor.perf.frames` (or the frames of a detail answer).
 * @returns The value typed, or undefined.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.readFramesWire is not built yet.`
 */
export function readFramesWire(_value: Json): PerfFramesWire | undefined {
  return notBuilt("readFramesWire");
}
