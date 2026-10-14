/**
 * @file perf/graph — the types of the frame-graph painter: the structural 2D context it draws on,
 * the view it is asked to paint and the state it keeps between paints. No DOM type is named here, so
 * the module type-checks without `lib.dom`; a browser's CanvasRenderingContext2D is assignable to
 * `GraphContext2D`.
 */

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
};

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
  /** The readout's value of the last paint (ms to 0.1; −1 for SKIP). */
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
};
