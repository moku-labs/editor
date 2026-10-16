/**
 * @file renderView timeline — the requestAnimationFrame loop of the mounted Mission control (spec 09
 * § M11): one loop paints every canvas of the Render workspace (`canvas[data-paint]`: the timeline,
 * the lane, the overview, the cards' sparklines, the Device load halves and the health line) on the
 * playout clock. A canvas repaints only when its key changed (the data, the view end quantised to a
 * device pixel of its own scale, the span, the selection, the cursor, the palette, its size or dpr);
 * the loop sleeps when nothing changes and the clock has eased to a stop, and wakes on new data, a
 * cursor move, a resize, a shown tab or a reduced-motion change. The canvases are found again after
 * every notification of Mission control (the only renders that add or drop one: a source change). Canvas sizes come from a
 * ResizeObserver; colours from the scope root's tokens, read once per theme and source. A frame
 * allocates nothing: every value it keeps is a number on an object made once.
 */
import { activeSourcePlugin } from "../../activeSource";
import { workspacePlugin } from "../../workspace";
import { graphFlags } from "../derive/mission";
import { firstVisibleRow, newestEnd, rowFrom } from "../series/rows";
import type { SourceMarker } from "../source/contract";
import { HISTORY_MS } from "../source/contract";
import { timeOriginOf } from "../source/sync";
import { subscribeMission } from "../state";
import type { MissionState, RenderViewCtx } from "../types";
import { liveEnd, STALE_AFTER_MS } from "../view/clock";
import { onHoverMove } from "../view/hover";
import { newestAwakeBudget, paintFrames } from "./frames";
import { paintHealth } from "./health";
import { paintLane } from "./lane";
import type { TimelineLayout } from "./layout";
import { boxLayout, framesLayout, laneLayout, sparkLayout, yMaxOf } from "./layout";
import { paintOverview } from "./overview";
import type { PaletteKey } from "./palette";
import { readPalette } from "./palette";
import type { PaintScene } from "./scene";
import { createPaintScene, markerTime, setMarker } from "./scene";
import type { SparkColumns } from "./spark";
import {
  createSparkColumns,
  fillFromFrames,
  fillFromSeries,
  fillPassGpu,
  paintCpuSteps,
  paintGpuSteps,
  paintSpark,
  SPARK_COLUMNS
} from "./spark";

/** What a canvas shows (its `data-paint`). */
type SurfaceKind = "timeline" | "lane" | "overview" | "health" | "spark" | "cpu" | "gpu";

/** What a card's sparkline charts (its `data-spark`). */
type SparkKind = "fps" | "frame" | "draws" | "textures" | "gpu" | "memory";

/** A sparkline's scale and colour, changed in place per paint. */
type MutableStyle = { min: number; max: number; reference: number; colour: PaletteKey };

/** One canvas the loop paints, with the key of its last paint. */
type Surface = {
  readonly canvas: HTMLCanvasElement;
  readonly kind: SurfaceKind;
  readonly spark: SparkKind | undefined;
  g: CanvasRenderingContext2D | null | undefined;
  width: number;
  height: number;
  dpr: number;
  layout: TimelineLayout;
  readonly columns: SparkColumns | undefined;
  readonly style: MutableStyle;
  /** The key of the last paint; `painted` false forces the next. */
  painted: boolean;
  notified: number;
  endPx: number;
  livePx: number;
  span: number;
  selection: number;
  hover: number | undefined;
  palette: number;
  seen: boolean;
};

/** The GPU clock range of no reading (paintGpuSteps takes null for "the series' own"). */
// eslint-disable-next-line unicorn/no-null -- the painter's "no range"
const NO_MHZ = null;

/** The painted scene of each running loop (the components read its flag boxes and view). */
const SCENES = new WeakMap<MissionState, PaintScene>();

/**
 * The scene a running loop painted last: the view's end and span, the live end and the spike flags'
 * boxes, for the pointer handlers of the timeline and the overview. None before the loop's first
 * frame.
 *
 * @param mission - Mission control's state.
 * @returns The scene; undefined while no loop runs.
 * @example
 * ```ts
 * const flag = flagAt(paintedScene(mission)!.hits, x, y);
 * ```
 */
export function paintedScene(mission: MissionState): PaintScene | undefined {
  return SCENES.get(mission);
}

/** The kinds a `data-paint` names. */
const KINDS: ReadonlySet<string> = new Set([
  "timeline",
  "lane",
  "overview",
  "health",
  "spark",
  "cpu",
  "gpu"
]);

/** The measures a `data-spark` names. */
const SPARKS: ReadonlySet<string> = new Set(["fps", "frame", "draws", "textures", "gpu", "memory"]);

/**
 * Whether a `data-paint` names a surface kind.
 *
 * @param value - The attribute.
 * @returns Whether it is one.
 */
function isKind(value: string | undefined): value is SurfaceKind {
  return value !== undefined && KINDS.has(value);
}

/**
 * Whether a `data-spark` names a sparkline measure.
 *
 * @param value - The attribute.
 * @returns Whether it is one.
 */
function isSpark(value: string | undefined): value is SparkKind {
  return value !== undefined && SPARKS.has(value);
}

/**
 * The geometry of a surface at its size.
 *
 * @param kind - What it shows.
 * @param width - CSS px.
 * @param height - CSS px.
 * @param dpr - devicePixelRatio.
 * @returns The layout.
 */
function layoutOf(kind: SurfaceKind, width: number, height: number, dpr: number): TimelineLayout {
  if (kind === "timeline") return framesLayout(width, height, dpr);
  if (kind === "lane") return laneLayout(width, height, dpr);
  if (kind === "overview" || kind === "health") return boxLayout(width, height, dpr);
  return sparkLayout(width, height, dpr);
}

/**
 * Makes the surface of a canvas: its kind, its first size (one layout read, when it is added) and an
 * empty key.
 *
 * @param canvas - The canvas.
 * @param kind - What it shows.
 * @returns The surface.
 */
function surfaceOf(canvas: HTMLCanvasElement, kind: SurfaceKind): Surface {
  const rect = canvas.getBoundingClientRect();
  const dpr = globalThis.devicePixelRatio || 1;
  const spark = isSpark(canvas.dataset.spark) ? canvas.dataset.spark : undefined;
  return {
    canvas,
    kind,
    spark,
    g: undefined,
    width: rect.width,
    height: rect.height,
    dpr,
    layout: layoutOf(kind, rect.width, rect.height, dpr),
    columns: kind === "spark" ? createSparkColumns() : undefined,
    style: { min: 0, max: 1, reference: Number.NaN, colour: "src" },
    painted: false,
    notified: -1,
    endPx: Number.NaN,
    livePx: Number.NaN,
    span: 0,
    selection: -1,
    hover: undefined,
    palette: -1,
    seen: true
  };
}

/**
 * The overview's words left of a source switch: the device a "disconnected here" marker names.
 *
 * @param marker - The newest marker.
 * @returns "Galaxy A26"; undefined when the marker names no source before it.
 * @example
 * ```ts
 * markerBefore({ at: 0, kind: "lost", label: "Galaxy A26 disconnected here · Local preview resumed", device: "d-7f3a" }); // "Galaxy A26"
 * ```
 */
export function markerBefore(marker: SourceMarker | undefined): string | undefined {
  const cut = marker?.label.indexOf(" disconnected here") ?? -1;
  if (marker === undefined || cut <= 0) return undefined;
  return marker.label.slice(0, cut);
}

/**
 * Starts the loop over the canvases inside `root` (the Render workspace): returns its stop (the
 * mount's effect cleanup, and Render hidden through `mission.stopLoop`). Stopping twice is safe.
 *
 * @param ctx - Domain context of renderView.
 * @param root - The Render workspace's root (its canvases inside; its tokens give the colours).
 * @returns Stops it.
 * @example
 * ```ts
 * mission.stopLoop = startLoop(ctx, root); // the timeline, lane, overview and cards paint live
 * ```
 */
export function startLoop(ctx: RenderViewCtx, root: HTMLElement): () => void {
  const { mission } = ctx.state;
  const workspace = ctx.require(workspacePlugin);
  const activeSource = ctx.require(activeSourcePlugin);
  const surfaces: Surface[] = [];
  const byCanvas = new Map<Element, Surface>();
  const scene = createPaintScene(readPalette(root));
  const sparkView = { startMs: 0, span: 6000 };
  const gpuRange: { minMhz: number | null; maxMhz: number | null } = {
    minMhz: NO_MHZ,
    maxMhz: NO_MHZ
  };
  const motion =
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
      : undefined;
  let reduced = motion?.matches === true;
  let handle = 0;
  let stopped = false;
  let rescan = true;
  let notified = 0;
  let paletteVersion = 0;
  let theme = workspace.theme();
  let source = mission.source;
  let state = -1;
  let healthAt = Number.NEGATIVE_INFINITY;
  let healthHead = -1;
  let healthNewest = Number.NaN;
  let healthDirty = true;
  let texturesBudget = Number.NaN;
  let displayHz = 60;

  /** Asks for the next frame unless one is queued or the loop stopped. */
  const wake = (): void => {
    if (stopped || handle !== 0) return;
    handle = globalThis.requestAnimationFrame(frame);
  };

  const sizes =
    typeof globalThis.ResizeObserver === "function"
      ? new globalThis.ResizeObserver(entries => {
          for (const entry of entries) {
            const surface = byCanvas.get(entry.target);
            if (surface === undefined) continue;
            surface.width = entry.contentRect.width;
            surface.height = entry.contentRect.height;
            surface.painted = false;
          }
          wake();
        })
      : undefined;

  /** Finds the canvases now under the root: new ones become surfaces, gone ones are dropped. */
  const scan = (): void => {
    rescan = false;
    for (const surface of surfaces) surface.seen = false;
    for (const canvas of root.querySelectorAll<HTMLCanvasElement>("canvas[data-paint]")) {
      const known = byCanvas.get(canvas);
      if (known !== undefined) {
        known.seen = true;
        continue;
      }
      const kind = canvas.dataset.paint;
      if (!isKind(kind)) continue;
      const surface = surfaceOf(canvas, kind);
      surfaces.push(surface);
      byCanvas.set(canvas, surface);
      sizes?.observe(canvas);
      if (kind === "health") healthDirty = true;
    }
    for (let index = surfaces.length - 1; index >= 0; index -= 1) {
      const surface = surfaces[index];
      if (surface === undefined || surface.seen) continue;
      surfaces.splice(index, 1);
      byCanvas.delete(surface.canvas);
      sizes?.unobserve(surface.canvas);
    }
  };

  /** What changed with a notify: the sections, the marker, the clock range, the scales. */
  const refreshState = (): void => {
    state = notified;
    const flags = graphFlags(mission);
    scene.gc = flags.gc;
    scene.gpu = flags.gpu === "on";
    scene.passes = flags.passes;
    const markers = activeSource.markers();
    const marker = markers.at(-1);
    const { history } = mission;
    const firstT = history.count > 0 ? history.t[0] : undefined;
    const t =
      marker === undefined
        ? Number.NaN
        : markerTime(marker, activeSource.clockOffsetMs(), timeOriginOf(mission.second), firstT);
    setMarker(scene, marker, t, markerBefore(marker));
    const gpu = mission.telemetry?.gpu;
    gpuRange.minMhz = gpu?.available === true ? gpu.value.minMhz : NO_MHZ;
    gpuRange.maxMhz = gpu?.available === true ? gpu.value.maxMhz : NO_MHZ;
    texturesBudget = ctx.state.assets?.budgetMb ?? Number.NaN;
    displayHz = mission.second?.rate.displayHz ?? mission.second?.display?.hz ?? 60;
  };

  /** Reads the colours again after a theme or source change (the source tints the sparklines). */
  const refreshPalette = (): void => {
    const now = workspace.theme();
    if (now === theme && mission.source === source) return;
    theme = now;
    source = mission.source;
    scene.palette = readPalette(root);
    paletteVersion += 1;
  };

  /**
   * The 2D context of a surface, sized to its box at the dpr, its transform set; undefined when the
   * canvas has none (no 2D on this page) or no size yet.
   *
   * @param surface - The surface.
   * @param dpr - devicePixelRatio now.
   * @returns The context.
   */
  const contextOf = (surface: Surface, dpr: number): CanvasRenderingContext2D | undefined => {
    if (surface.width <= 0 || surface.height <= 0) return undefined;
    if (surface.g === undefined) surface.g = surface.canvas.getContext("2d");
    const { g, canvas } = surface;
    if (g === null) return undefined;
    const width = Math.round(surface.width * dpr);
    const height = Math.round(surface.height * dpr);
    if (canvas.width !== width || canvas.height !== height || surface.dpr !== dpr) {
      canvas.width = width;
      canvas.height = height;
      surface.dpr = dpr;
      surface.layout = layoutOf(surface.kind, surface.width, surface.height, dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  };

  /**
   * Whether a surface's key changed since its last paint; keeps the new key.
   *
   * @param surface - The surface.
   * @param dpr - devicePixelRatio now.
   * @returns Whether to paint it.
   */
  const keyChanged = (surface: Surface, dpr: number): boolean => {
    const width = surface.kind === "overview" ? surface.width : surface.layout.plot.w;
    const scale = surface.kind === "overview" ? HISTORY_MS : scene.span;
    const endPx = Math.round((scene.endMs / scale) * width * dpr);
    const livePx = Math.round((scene.liveEndMs / HISTORY_MS) * surface.width * dpr);
    const changed =
      !surface.painted ||
      surface.notified !== notified ||
      surface.endPx !== endPx ||
      (surface.kind === "overview" && surface.livePx !== livePx) ||
      surface.span !== scene.span ||
      surface.selection !== mission.selectionVersion ||
      surface.hover !== mission.hoverMs ||
      surface.palette !== paletteVersion ||
      surface.dpr !== dpr;
    surface.painted = true;
    surface.notified = notified;
    surface.endPx = endPx;
    surface.livePx = livePx;
    surface.span = scene.span;
    surface.selection = mission.selectionVersion;
    surface.hover = mission.hoverMs;
    surface.palette = paletteVersion;
    return changed;
  };

  /**
   * The largest and smallest value of a sparkline's columns.
   *
   * @param columns - The columns.
   * @param style - Written: `min` the smallest, `max` the largest (NaN without a value).
   */
  const extentOf = (columns: SparkColumns, style: MutableStyle): void => {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < SPARK_COLUMNS; index += 1) {
      const value = columns.v[index] ?? Number.NaN;
      if (Number.isNaN(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    style.min = Number.isFinite(low) ? low : Number.NaN;
    style.max = Number.isFinite(high) ? high : Number.NaN;
  };

  /**
   * Fills a card's columns from the history or its series and sets its scale (spec 09 § M9).
   *
   * @param surface - A sparkline surface.
   * @param columns - Its columns.
   */
  const fillSpark = (surface: Surface, columns: SparkColumns): void => {
    const { history, series } = mission;
    const { style } = surface;
    sparkView.startMs = scene.endMs - scene.span;
    sparkView.span = scene.span;
    style.reference = Number.NaN;
    switch (surface.spark) {
      case "fps": {
        fillFromFrames(columns, history, "fps", sparkView);
        style.min = 0;
        style.max = 1.15 * displayHz;
        style.reference = displayHz;
        return;
      }
      case "frame": {
        fillFromFrames(columns, history, "worst", sparkView);
        const first = firstVisibleRow(history, sparkView.startMs);
        const budget = newestAwakeBudget(history, first, rowFrom(history, scene.endMs));
        style.min = 0;
        style.max = yMaxOf(budget);
        style.reference = budget;
        return;
      }
      case "draws": {
        fillFromFrames(columns, history, "draws", sparkView);
        extentOf(columns, style);
        style.max = Math.max(80, (Number.isNaN(style.max) ? 0 : style.max) * 1.1);
        style.min = 0;
        return;
      }
      case "textures": {
        fillFromSeries(columns, series.textures, sparkView.startMs, sparkView.span);
        extentOf(columns, style);
        const seen = Number.isNaN(style.max) ? 0 : style.max;
        style.max = Number.isNaN(texturesBudget) ? Math.max(1, seen * 1.2) : texturesBudget;
        style.reference = texturesBudget;
        style.min = 0;
        return;
      }
      case "gpu": {
        fillPassGpu(columns, history, sparkView);
        extentOf(columns, style);
        style.max = Math.max(4, (Number.isNaN(style.max) ? 0 : style.max) * 1.15);
        style.min = 0;
        return;
      }
      default: {
        fillFromSeries(columns, series.heap, sparkView.startMs, sparkView.span);
        extentOf(columns, style);
        const spread = Math.max(1, (style.max || 0) - (style.min || 0));
        style.min = Number.isNaN(style.min) ? 0 : Math.max(0, style.min - spread * 0.15);
        style.max = Number.isNaN(style.max) ? 1 : style.max + spread * 0.15;
      }
    }
  };

  /**
   * Paints one surface.
   *
   * @param surface - The surface.
   * @param g - Its context (transform set).
   */
  const paint = (surface: Surface, g: CanvasRenderingContext2D): void => {
    const { layout } = surface;
    switch (surface.kind) {
      case "timeline": {
        paintFrames(g, layout, mission, scene);
        return;
      }
      case "lane": {
        paintLane(g, layout, mission, scene);
        return;
      }
      case "overview": {
        paintOverview(g, layout, mission, scene);
        return;
      }
      case "health": {
        g.clearRect(0, 0, surface.width, surface.height);
        paintHealth(g, layout, activeSource.health(), scene.palette);
        return;
      }
      case "cpu": {
        g.clearRect(0, 0, surface.width, surface.height);
        paintCpuSteps(g, layout, mission.series.load, scene);
        return;
      }
      case "gpu": {
        g.clearRect(0, 0, surface.width, surface.height);
        paintGpuSteps(g, layout, mission.series.load, scene, gpuRange);
        return;
      }
      default: {
        const { columns } = surface;
        if (columns === undefined) return;
        fillSpark(surface, columns);
        g.clearRect(0, 0, surface.width, surface.height);
        paintSpark(g, layout, columns, surface.style, scene, mission);
      }
    }
  };

  /**
   * Whether the health ring has a new sample (checked once a second: the ring fills at 1 Hz).
   *
   * @param now - performance.now().
   * @returns Whether the health line needs a paint.
   */
  const healthChanged = (now: number): boolean => {
    if (!healthDirty && now - healthAt < 1000) return false;
    healthAt = now;
    healthDirty = false;
    const health = activeSource.health();
    const newest = health.samples[health.head] ?? Number.NaN;
    const changed = health.head !== healthHead || !Object.is(newest, healthNewest);
    healthHead = health.head;
    healthNewest = newest;
    return changed;
  };

  /**
   * Places the view of this frame on the scene: the live end on the playout clock (or the newest
   * frame's end before the clock ran), the view's end and span.
   *
   * @param now - performance.now().
   */
  const placeView = (now: number): void => {
    const live = liveEnd(mission.clock, now, reduced) ?? newestEnd(mission.history) ?? 0;
    scene.liveEndMs = live;
    scene.live = mission.view.live;
    scene.endMs = mission.view.live ? live : mission.view.endMs;
    scene.span = mission.view.span;
    if (SCENES.get(mission) !== scene) SCENES.set(mission, scene);
  };

  /**
   * Paints every surface whose key changed.
   *
   * @param now - performance.now().
   * @returns Whether a surface was painted.
   */
  const paintChanged = (now: number): boolean => {
    const dpr = globalThis.devicePixelRatio || 1;
    const health = healthChanged(now);
    let painted = false;
    // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint: no iterator per frame
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index];
      if (surface === undefined) continue;
      const changed =
        surface.kind === "health" ? health || !surface.painted : keyChanged(surface, dpr);
      surface.painted = true;
      const g = changed ? contextOf(surface, dpr) : undefined;
      if (g === undefined) continue;
      paint(surface, g);
      painted = true;
    }
    return painted;
  };

  /**
   * Whether frames still flow: the view is live and the newest arrival is recent (the clock has not
   * eased to a stop yet).
   *
   * @param now - performance.now().
   * @returns Whether the next frame may move the view.
   */
  const flowing = (now: number): boolean => {
    const { clock } = mission;
    return (
      mission.view.live &&
      clock.arrivedAt !== undefined &&
      now - clock.arrivedAt < STALE_AFTER_MS + clock.delayMs
    );
  };

  /**
   * One frame: the view's end on the playout clock, then every surface whose key changed; the next
   * frame is asked for while something painted or frames still flow.
   */
  function frame(): void {
    handle = 0;
    if (stopped || root.ownerDocument.visibilityState === "hidden") return;
    const now = performance.now();
    if (rescan) scan();
    if (state !== notified) refreshState();
    refreshPalette();
    placeView(now);
    if (paintChanged(now) || flowing(now)) wake();
  }

  const offMission = subscribeMission(mission, () => {
    notified += 1;
    rescan = true;
    wake();
  });
  const offHover = onHoverMove(mission, wake);
  const onMotion = (): void => {
    reduced = motion?.matches === true;
    wake();
  };
  motion?.addEventListener("change", onMotion);
  root.ownerDocument.addEventListener("visibilitychange", wake);
  wake();

  return () => {
    if (stopped) return;
    stopped = true;
    if (handle !== 0) globalThis.cancelAnimationFrame(handle);
    handle = 0;
    offMission();
    offHover();
    motion?.removeEventListener("change", onMotion);
    root.ownerDocument.removeEventListener("visibilitychange", wake);
    sizes?.disconnect();
    surfaces.length = 0;
    byCanvas.clear();
    if (SCENES.get(mission) === scene) SCENES.delete(mission);
  };
}
