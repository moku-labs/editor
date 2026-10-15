/**
 * @file overlay plugin — the graph's compositor slide (spec 08 Delta 2026-10-15; decision "Smooth
 * graph scroll by a compositor slide, paint stays <= 4 Hz"): after each paint the canvas, painted one
 * tick wider than its well, is put back at 0 and slid one tick to the left by a single linear CSS
 * transition over `PAINT_MS`. No per-frame JavaScript; the next paint resets it. Reduced motion
 * (the page's or the game's) slides nothing.
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
 * Starts the slide of a fresh paint: back to `translateX(0)` without a transition, the reset
 * forced (a style read, no layout), then one `PAINT_MS` linear transition to `-lead` px. A lead of 0
 * (reduced motion, no scale yet) only resets.
 *
 * @param state - Overlay state.
 * @param element - The canvas.
 * @param lead - The slide distance, CSS px.
 */
export function startSlide(state: OverlayState, element: HTMLElement, lead: number): void {
  const style = element.style;
  // Reset to the paint's own position, with no transition.
  style.setProperty("transition", "none");
  style.setProperty("transform", "translateX(0px)");
  state.slide.px = lead;
  state.slide.at = Date.now();
  if (lead === 0) return;

  // Apply the reset before the transition starts, then slide one tick to the left.
  element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue("transform");
  style.setProperty("transition", `transform ${PAINT_MS}ms linear`);
  style.setProperty("transform", `translateX(${-lead}px)`);
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
  const { px, at } = state.slide;
  if (px === 0) return 0;
  return Math.min(1, Math.max(0, (now - at) / PAINT_MS)) * px;
}
