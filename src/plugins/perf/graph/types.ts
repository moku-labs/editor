/**
 * @file perf/graph — the types of the frame-graph painter: the structural 2D context it draws on,
 * the view it is asked to paint and the state it keeps between paints. No DOM type is named here, so
 * the module type-checks without `lib.dom`; a browser's CanvasRenderingContext2D is assignable to
 * `GraphContext2D`.
 */
import type { GraphPalette } from "./palette";

/**
 * The members of a canvas 2D context the painter calls, and nothing more. A browser's
 * CanvasRenderingContext2D is assignable to it; tests pass a recording fake.
 *
 * @example
 * ```ts
 * const g: GraphContext2D = canvas.getContext("2d")!; // in the overlay and the tools strip
 * paintGraph(g, window, { width: 273, height: 108, wide: false, selected: -1 }, createGraphState(1024));
 * ```
 */
export type GraphContext2D = {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
};

/**
 * How to paint one graph. The phone card's graph is 273×108 CSS px; the tools strip's is about
 * 1000×200.
 *
 * @example
 * ```ts
 * const view: GraphView = { width: 273, height: 108, wide: false, selected: -1 };
 * ```
 */
export type GraphView = {
  /** CSS px of the canvas box. */
  readonly width: number;
  /** CSS px of the canvas box. */
  readonly height: number;
  /** The tools strip (D1): wider tape and flags, an axis label every second, no stack legend. */
  readonly wide: boolean;
  /** The selected row of the window; −1 = none (the cursor and the readout follow the newest frame). */
  readonly selected: number;
  /**
   * CSS px of plot past the visible right edge, for a canvas painted wider than its well and slid
   * left by a compositor transition between paints: `width` includes it, the time scale is the
   * one of a `width − leadPx` canvas, `now` is drawn `leadPx` further right, and the texts anchored
   * at the left (the oldest axis label, the caption, the stack legend's centre) move right by it.
   * 0 by default.
   */
  readonly leadPx?: number;
  /**
   * The part to paint (default `"all"`, the whole graph). `"plot"` is what is tied to time (the
   * rows, the budget lines, the flags, the axis's seconds), for a canvas that slides. `"fixed"` is
   * what marks a place (the tape and its readout, the caption, `now`, the stack legend) on a
   * transparent ground, for a canvas of the same visible size laid over the plot that does not
   * slide: paint it without a lead. `"base"` is the static part (the well, the grid, the tape's
   * ground, spine and ticks) for an offscreen canvas redrawn only on a size, theme or scale change;
   * `"over"` is everything else, painted each frame over a blit of the base.
   */
  readonly layer?: GraphLayer;
  /**
   * The look: the colours, cause hues and fonts to paint in. The overlay's glass cockpit by default;
   * the tools page passes the editor's light or dark look (`themes.ts`, spec 09 Delta 2026-10-15). A
   * look with another `key` resets the state's text cache.
   */
  readonly look?: GraphLook;
  /**
   * Page-clock ms of the plot's right edge, for the tools page's interpolated drawing (spec 09
   * Amendments 2026-10-15 and 2026-10-16): the axis runs to this moving now and only the rows inside
   * the span are drawn. Past the newest row, that row ends at its own end; before it, the newer rows
   * are held back (they slide in from the right edge as the now reaches them). The window's `endMs`
   * by default.
   */
  readonly nowMs?: number;
  /**
   * The time the plot spans under a `nowMs`, ms (the tools page cuts its playout delay off the
   * window's span, so the left edge never runs before the oldest row). The window's span by default;
   * without a `nowMs` it is not read.
   */
  readonly spanMs?: number;
};

/**
 * The fonts of one graph size: the flags, the tape, the readout, the axis and the rate labels.
 *
 * @example
 * ```ts
 * const fonts: GraphFonts = { flag: "600 11px Geist", tape: "500 11px Geist Mono", readout: "600 14px Geist Mono", axis: "500 11px Geist", rate: "500 10.5px Geist Mono" };
 * ```
 */
export type GraphFonts = {
  readonly flag: string;
  readonly tape: string;
  readonly readout: string;
  readonly axis: string;
  readonly rate: string;
};

/**
 * What a graph is painted in: its colours, the hue of each primary cause code (CAUSE_RANK order,
 * index = code − 1) and its fonts per size; `key` names it, so a painter state knows when its
 * measured text no longer fits.
 *
 * @example
 * ```ts
 * const look: GraphLook = graphLook("dark"); // themes.ts, the tools page only
 * paintGraph(g, window, { width: 1000, height: 200, wide: true, selected: -1, look }, state);
 * ```
 */
export type GraphLook = {
  readonly key: string;
  readonly colours: GraphPalette;
  readonly hues: readonly string[];
  readonly fonts: { readonly phone: GraphFonts; readonly wide: GraphFonts };
};

/**
 * A part of the graph to paint: the whole of it, the plot that slides, or what stays over it.
 *
 * @example
 * ```ts
 * const layer: GraphLayer = "fixed";
 * ```
 */
export type GraphLayer = "all" | "plot" | "fixed" | "base" | "over";

/**
 * What a painter keeps between paints, made once per canvas (`createGraphState`): the hit boxes of
 * the flags and the last layout (for `spikeAt` / `rowAt`), legend widths measured once per font, and
 * the cached label strings with the keys they were built for.
 *
 * @example
 * ```ts
 * const graph: GraphState = createGraphState(1024);
 * paintGraph(g, window, view, graph);
 * graph.flagCount; // 6: one hit box per spike flag
 * ```
 */
export type GraphState = {
  /** The row of each flag of the last paint. */
  readonly flagRow: Int32Array;
  /** The left edge of each flag box, CSS px. */
  readonly flagX0: Float32Array;
  /** The right edge of each flag box, CSS px. */
  readonly flagX1: Float32Array;
  /** Flags of the last paint. */
  flagCount: number;
  /** Left edge of the plot of the last paint, CSS px. */
  px0: number;
  /** Right edge of the plot (the tape's left edge), CSS px. */
  px1: number;
  /** Top of the plot, CSS px. */
  py0: number;
  /** Bottom of the plot (the baseline), CSS px. */
  py1: number;
  /** Height of the flag band, CSS px. */
  flagBand: number;
  /** Page-clock ms of the plot's left edge. */
  startMs: number;
  /** Page-clock ms the plot spans. */
  spanMs: number;
  /** Width of each cause legend (CAUSE_RANK order) in the flag font; NaN until measured. */
  readonly legendWidth: Float32Array;
  /** The legends were measured in the current font. */
  measured: boolean;
  /** The readout's value of the last paint (ms to 0.1; −1 for SKIP, −2 for IDLE). */
  readoutMs: number;
  /** The readout's text for `readoutMs`. */
  readoutText: string;
  /** The caption's key: frame, spike ordinal and spike count it was built for. */
  captionKey: string;
  /** The caption's text for `captionKey`. */
  captionText: string;
  /** The frame of `captionKey`; −1 before the first caption. */
  captionFrame: number;
  /** The spike ordinal of `captionKey`. */
  captionOrdinal: number;
  /** The spike count of `captionKey`. */
  captionCount: number;
  /** The window length, ms in whole seconds, the axis labels were built for. */
  axisWindowMs: number;
  /** Axis labels, oldest second first: "−6 s" … "−1 s". */
  readonly axisText: string[];
  /** The newest budget the tape labels were built for. */
  tapeBudgetMs: number;
  /** Tape label of the newest budget ("16.7"). */
  tapeBudgetText: string;
  /** Tape label of half the newest budget ("8.3"). */
  tapeHalfText: string;
  /** Rate-switch labels ("60", "120"), built once per fps value seen. */
  readonly rateText: Map<number, string>;
  /** The key of the look of the last paint; another look resets the text cache. */
  lookKey: string;
  /** The right edge of the newest row of the last paint, CSS px: `px1`, or left of it under a moving now. */
  edgeX: number;
};
