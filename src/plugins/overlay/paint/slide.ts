/**
 * @file overlay plugin — the graph's compositor slide (spec 08 Delta 2026-10-15 and 2026-10-18;
 * decision "Smooth graph scroll by a compositor slide, paint stays <= 4 Hz"): the canvas is painted
 * two ticks wider than its well, and after each paint one linear CSS transition slides it on a
 * display time that runs at real time across paints (each paint starts where the last slide is
 * now). No per-frame JavaScript. Reduced motion (the page's or the game's) slides nothing.
 */
import type { OverlayRegistry, OverlayState } from "../types";
import { PAINT_MS } from "../types";

/** The page's reduced-motion query. */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * True when the page asks for reduced motion (the query is made once per state).
 *
 * @param state - Overlay state.
 * @returns Whether `prefers-reduced-motion: reduce` matches.
 */
function pageReducesMotion(state: OverlayState): boolean {
  const view = state.host?.ownerDocument.defaultView;
  if (view === null || view === undefined || typeof view.matchMedia !== "function") return false;
  state.motionQuery ??= view.matchMedia(REDUCED_MOTION);
  return state.motionQuery.matches;
}

/**
 * True when the game turned reduced motion on (`app.anim.reducedMotion()`, read structurally; a
 * game without the anim plugin, or a throw, reads as off).
 *
 * @param registry - The registry's game.
 * @returns Whether the game reduces motion.
 */
function gameReducesMotion(registry: Pick<OverlayRegistry, "game">): boolean {
  try {
    const anim: unknown = Reflect.get(registry.game(), "anim");
    if (typeof anim !== "object" || anim === null) return false;
    const reduced: unknown = Reflect.get(anim, "reducedMotion");
    return typeof reduced === "function" && reduced.call(anim) === true;
  } catch {
    return false;
  }
}

/**
 * Whether the next paint slides: neither the page nor the game asks for reduced motion.
 *
 * @param state - Overlay state.
 * @param registry - The registry's game.
 * @returns True to slide.
 */
export function slideAllowed(
  state: OverlayState,
  registry: Pick<OverlayRegistry, "game">
): boolean {
  return !pageReducesMotion(state) && !gameReducesMotion(registry);
}

/**
 * The ticks of data a paint keeps past the well's right edge: the slide's room. The right edge
 * shows the data `SLIDE_RUN_TICKS` ticks behind the newest, so one slide never runs out of data, and
 * one more tick is kept for a late or skipped paint.
 */
export const SLIDE_TICKS = 3;

/**
 * The ticks one slide lasts (and the delay behind the newest data the right edge aims at): two, so
 * a paint that comes late still finds the graph moving.
 */
export const SLIDE_RUN_TICKS = 2;

/** The largest change of the slide's speed toward its target: 20 % faster or slower. */
const TRIM = 0.2;

/** The distance to its target, ms, at which the speed's change is at its largest. */
const TRIM_SPAN_MS = 4 * PAINT_MS;

/**
 * Where the well's right edge is on the data's time now: the last slide's start moved toward its
 * end by the time gone, NaN before a slide.
 *
 * @param state - Overlay state.
 * @param now - Date.now().
 * @returns Page-clock ms of the data, or NaN.
 */
function edgeNow(state: OverlayState, now: number): number {
  const { px, at, durMs, edgeMs, toEdgeMs } = state.slide;
  if (px === 0 || durMs <= 0) return Number.NaN;
  const done = Math.min(1, Math.max(0, (now - at) / durMs));
  return edgeMs + (toEdgeMs - edgeMs) * done;
}

/**
 * Starts the slide of a fresh paint (Delta 2026-10-18). The canvas is painted `lead` px wider than
 * its well, its plot reaching the window's newest data (`endMs`); the well shows one stretch of it,
 * picked by translateX. The slide keeps the well's right edge on a display time that runs at real
 * time across paints: the new canvas starts at the time the last slide shows now (so a paint never
 * jumps the graph back or forth when the data's end stepped unevenly), then runs for two ticks,
 * a little faster or slower toward two ticks behind the newest data, and never past it. A lead of 0
 * (reduced motion, no scale yet) only resets.
 *
 * @param state - Overlay state.
 * @param element - The canvas.
 * @param lead - The canvas's extra width, CSS px (`SLIDE_TICKS` ticks at the window's scale).
 * @param endMs - The window's newest data, page-clock ms.
 * @param now - Date.now().
 */
export function startSlide(
  state: OverlayState,
  element: HTMLElement,
  lead: number,
  endMs: number,
  now: number
): void {
  const style = element.style;
  const slide = state.slide;
  style.setProperty("transition", "none");
  if (lead === 0) {
    style.setProperty("transform", "translateX(0px)");
    slide.px = 0;
    slide.at = now;
    return;
  }

  // The data's time at the well's right edge with the canvas at 0, and the scale.
  const leadMs = SLIDE_TICKS * PAINT_MS;
  const pxPerMs = lead / leadMs;
  const zeroMs = endMs - leadMs;
  // Two ticks behind the newest data: a slide at real time reaches it only at its own end (on the
  // A26 a target one tick behind made every slide hit the newest data halfway and slow to half
  // speed, a twitch each time the trim caught up).
  const durMs = SLIDE_RUN_TICKS * PAINT_MS;
  const target = endMs - durMs;
  // Carry on from what shows now; a first paint, or one too far off, starts on the target.
  const shown = edgeNow(state, now);
  const from = Number.isFinite(shown) && shown >= zeroMs && shown <= endMs ? shown : target;
  const speed = 1 + Math.min(TRIM, Math.max(-TRIM, (target - from) / TRIM_SPAN_MS));
  const to = Math.min(endMs, from + speed * durMs);
  slide.px = lead;
  slide.at = now;
  slide.durMs = durMs;
  slide.edgeMs = from;
  slide.toEdgeMs = to;
  slide.fromX = -(from - zeroMs) * pxPerMs;
  slide.toX = -(to - zeroMs) * pxPerMs;

  // Apply the start before the transition begins, then slide linearly to the end.
  style.setProperty("transform", `translateX(${slide.fromX}px)`);
  element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue("transform");
  style.setProperty("transition", `transform ${durMs}ms linear`);
  style.setProperty("transform", `translateX(${slide.toX}px)`);
}

/**
 * The plot canvas's x of a point in the well. On the tape (drawn on the fixed canvas, which covers
 * the well and does not slide) the point is given the same distance past the plot's right edge;
 * elsewhere the plot has slid left since the last paint, so the point is that much further right on
 * it.
 *
 * @param state - Overlay state.
 * @param x - CSS px from the well's left.
 * @param now - Date.now().
 * @returns CSS px from the plot canvas's left.
 */
export function plotXOf(state: OverlayState, x: number, now: number): number {
  const { graph, fixedGraph } = state;
  // The tape's left edge, in well px (the fixed canvas lies at the well's left), once laid out.
  const laidOut = fixedGraph !== undefined && fixedGraph.px1 > fixedGraph.px0;
  if (graph !== undefined && laidOut && x >= fixedGraph.px1) {
    return graph.px1 + (x - fixedGraph.px1);
  }
  return x + slideOffset(state, now);
}

/**
 * The slide's offset now: how far the canvas has moved left since the last paint, clamped to its
 * distance.
 *
 * @param state - Overlay state.
 * @param now - Date.now().
 * @returns CSS px (0 without a slide).
 */
export function slideOffset(state: OverlayState, now: number): number {
  const { px, at, durMs, fromX, toX } = state.slide;
  if (px === 0 || durMs <= 0) return 0;
  const done = Math.min(1, Math.max(0, (now - at) / durMs));
  return -(fromX + (toX - fromX) * done);
}
