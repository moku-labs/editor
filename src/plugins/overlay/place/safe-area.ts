/**
 * @file overlay plugin — the safe area, by the same CSS contract the engine reads
 * (`var(--moku-safe-*, env(safe-area-inset-*, 0px))`): two probes in the shadow root sized by the
 * stylesheet, read with getComputedStyle, and per side the larger of the probe and perf's display
 * insets. Re-read on resize, on `moku-native:insets` and when a probe resizes; never per tick.
 */
import { paintNow, withAgent } from "../paint/tick";
import type { Insets, OverlayCtx } from "../types";
import { layout, readViewport } from "./layout";

/**
 * A computed length in px; an unparsable value is 0.
 *
 * @param text - The computed value, e.g. "32px".
 * @returns The px.
 * @example
 * ```ts
 * pxOf("auto"); // 0
 * ```
 */
function pxOf(text: string): number {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Appends the two safe-area probes to the shadow root.
 *
 * @param doc - The document.
 * @param root - The shadow root.
 * @returns The probes: start (left, top), end (right, bottom).
 */
export function createProbes(doc: Document, root: ShadowRoot): HTMLElement[] {
  return ["start", "end"].map(side => {
    const probe = doc.createElement("div");
    probe.dataset.safeProbe = side;
    probe.setAttribute("aria-hidden", "true");
    root.append(probe);
    return probe;
  });
}

/**
 * The insets the probes report.
 *
 * @param octx - Domain context.
 * @returns The insets; zeros without probes or a window.
 */
function probeInsets(octx: OverlayCtx): Insets {
  const [start, end] = octx.state.probes;
  const view = octx.state.host?.ownerDocument.defaultView;
  if (start === undefined || end === undefined || view === null || view === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const first = view.getComputedStyle(start);
  const last = view.getComputedStyle(end);
  return {
    top: pxOf(first.height),
    right: pxOf(last.width),
    bottom: pxOf(last.height),
    left: pxOf(first.width)
  };
}

/**
 * Reads the safe area into the state: per side the larger of the probes and perf's display insets
 * (a WebView without `env()` whose engine knows its insets still keeps the window clear).
 *
 * @param octx - Domain context.
 */
export function readInsets(octx: OverlayCtx): void {
  const probe = probeInsets(octx);
  const safe = octx.perf.second().display?.safeArea;
  octx.state.insets = {
    top: Math.max(probe.top, safe?.t ?? 0),
    right: Math.max(probe.right, safe?.r ?? 0),
    bottom: Math.max(probe.bottom, safe?.b ?? 0),
    left: Math.max(probe.left, safe?.l ?? 0)
  };
}

/**
 * Listens for what moves the window's box: the window's `resize` and `moku-native:insets`, and a
 * resize of either probe. While the window shows, each re-reads the viewport and the insets and lays
 * out inside the agent span, then repaints; while hidden it does nothing (the next visible mode
 * re-reads).
 *
 * @param octx - Domain context.
 * @param view - The host's window.
 */
export function watchPlace(octx: OverlayCtx, view: Window | undefined): void {
  const { state } = octx;
  const relayout = (): void => {
    if (state.mode === "hidden") return;
    withAgent(octx, () => {
      readViewport(state);
      readInsets(octx);
      layout(state);
    });
    paintNow(octx);
  };
  if (view !== undefined) {
    view.addEventListener("resize", relayout);
    view.addEventListener("moku-native:insets", relayout);
    state.off.push(() => {
      view.removeEventListener("resize", relayout);
      view.removeEventListener("moku-native:insets", relayout);
    });
  }
  if (typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(relayout);
  for (const probe of state.probes) observer.observe(probe);
  state.off.push(() => {
    observer.disconnect();
  });
}
