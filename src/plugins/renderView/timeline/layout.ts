/**
 * @file renderView timeline — the geometry of Mission control's canvases (spec 09 § M8, M9): the
 * frame timeline (gutter R = 50 on the right, TOP = 30, axis band AX = 20, GC lane GCL = 22), the
 * Shaders & passes lane (TOP = 24, 5 below), the overview, the sparklines (top 3, bottom 7) and the
 * health line; the 2D context the painters draw on; and the two scales `X(t)` and `Y(ms)`. Pure.
 */

/**
 * The 2D context a painter draws on: the calls the painters make. A browser's
 * `CanvasRenderingContext2D` is one; a test passes a recording fake.
 *
 * @example
 * ```ts
 * const g: PaintContext = canvas.getContext("2d")!;
 * ```
 */
export type PaintContext = {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
};

/**
 * A canvas's geometry, CSS px (the backing store is `width × dpr` by `height × dpr`): the plot where
 * time runs left to right, the gutter on its right, the GC lane under it and the axis band at the
 * bottom (0 where a canvas has none).
 *
 * @example
 * ```ts
 * const layout: TimelineLayout = framesLayout(960, 262, 2);
 * layout.plot; // { x: 0, y: 30, w: 910, h: 190 }
 * ```
 */
export type TimelineLayout = {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly plot: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The GC lane's height under the plot (the frame timeline's 22). */
  readonly lane: number;
  /** The axis band's height at the bottom (the frame timeline's 20). */
  readonly axis: number;
};

/** The frame timeline's gutter on the right, px. */
export const GUTTER = 50;

/** The frame timeline's space above the plot, px. */
const FRAMES_TOP = 30;

/** The frame timeline's axis band, px. */
const AXIS = 20;

/** The frame timeline's GC lane, px. */
const GC_LANE = 22;

/** The lane's space above its plot, px. */
const LANE_TOP = 24;

/** The lane's space below its plot, px. */
const LANE_BOTTOM = 5;

/** A sparkline's space above and below its plot, px. */
const SPARK_TOP = 3;
const SPARK_BOTTOM = 7;

/**
 * The frame timeline's geometry: plot from TOP to `H − AX − GCL`, `W − R` wide.
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param dpr - devicePixelRatio.
 * @returns The layout.
 * @example
 * ```ts
 * framesLayout(960, 262, 2).plot.h; // 190
 * ```
 */
export function framesLayout(width: number, height: number, dpr: number): TimelineLayout {
  const bottom = height - AXIS - GC_LANE;
  return {
    width,
    height,
    dpr,
    plot: {
      x: 0,
      y: FRAMES_TOP,
      w: Math.max(1, width - GUTTER),
      h: Math.max(1, bottom - FRAMES_TOP)
    },
    lane: GC_LANE,
    axis: AXIS
  };
}

/**
 * The Shaders & passes lane's geometry: the timeline's width less the gutter, plot from 24 to
 * `H − 5`.
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param dpr - devicePixelRatio.
 * @returns The layout.
 * @example
 * ```ts
 * laneLayout(960, 78, 2).plot.h; // 49
 * ```
 */
export function laneLayout(width: number, height: number, dpr: number): TimelineLayout {
  return {
    width,
    height,
    dpr,
    plot: {
      x: 0,
      y: LANE_TOP,
      w: Math.max(1, width - GUTTER),
      h: Math.max(1, height - LANE_BOTTOM - LANE_TOP)
    },
    lane: 0,
    axis: 0
  };
}

/**
 * The geometry of a canvas whose plot is the whole box (the overview, the health line).
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param dpr - devicePixelRatio.
 * @returns The layout.
 * @example
 * ```ts
 * boxLayout(900, 40, 2).plot; // { x: 0, y: 0, w: 900, h: 40 }
 * ```
 */
export function boxLayout(width: number, height: number, dpr: number): TimelineLayout {
  return { width, height, dpr, plot: { x: 0, y: 0, w: width, h: height }, lane: 0, axis: 0 };
}

/**
 * A sparkline's geometry: plot from 3 to `H − 7`, the whole width.
 *
 * @param width - CSS px.
 * @param height - CSS px.
 * @param dpr - devicePixelRatio.
 * @returns The layout.
 * @example
 * ```ts
 * sparkLayout(220, 46, 2).plot; // { x: 0, y: 3, w: 220, h: 36 }
 * ```
 */
export function sparkLayout(width: number, height: number, dpr: number): TimelineLayout {
  return {
    width,
    height,
    dpr,
    plot: { x: 0, y: SPARK_TOP, w: width, h: Math.max(1, height - SPARK_BOTTOM - SPARK_TOP) },
    lane: 0,
    axis: 0
  };
}

/**
 * The plot's bottom, px.
 *
 * @param layout - The geometry.
 * @returns `plot.y + plot.h`.
 * @example
 * ```ts
 * plotBottom(framesLayout(960, 262, 2)); // 220
 * ```
 */
export function plotBottom(layout: TimelineLayout): number {
  return layout.plot.y + layout.plot.h;
}

/**
 * `X(t)`: a source-clock time's x in the plot.
 *
 * @param layout - The geometry.
 * @param t - Source-clock ms.
 * @param startMs - The view's start.
 * @param span - The view's span, ms.
 * @returns CSS px.
 * @example
 * ```ts
 * xOf(layout, 77_000, 74_000, 6000); // 455: the middle of a 910 px plot
 * ```
 */
export function xOf(layout: TimelineLayout, t: number, startMs: number, span: number): number {
  return layout.plot.x + ((t - startMs) / span) * layout.plot.w;
}

/**
 * `Y(ms)`: a frame time's y in the plot, capped at `yMax`.
 *
 * @param layout - The geometry.
 * @param ms - The time.
 * @param yMax - The plot's top value.
 * @returns CSS px.
 * @example
 * ```ts
 * yOf(layout, 18, 36); // 125: half way up a 190 px plot
 * ```
 */
export function yOf(layout: TimelineLayout, ms: number, yMax: number): number {
  return plotBottom(layout) - (Math.min(Math.max(ms, 0), yMax) / yMax) * layout.plot.h;
}

/**
 * The top of the frame timeline's scale from the newest awake budget: ≤ 8.4 ms → 20, ≤ 16.7 → 36,
 * else 72.
 *
 * @param budgetMs - The newest awake frame's budget.
 * @returns ms.
 * @example
 * ```ts
 * yMaxOf(8.33); // 20 at 120 fps
 * ```
 */
export function yMaxOf(budgetMs: number): number {
  if (budgetMs <= 8.4) return 20;
  if (budgetMs <= 16.7) return 36;
  return 72;
}
