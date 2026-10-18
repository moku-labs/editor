/**
 * @file overlay plugin — state factory.
 */
import type { Config, OverlayState } from "./types";

/**
 * Creates the initial overlay state: hidden, the card as the last visible mode, the Frames tab,
 * docked to `config.dock` at the bottom, not mounted. Storage, the document and globals are read
 * in onStart, never here.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns Hidden, empty state.
 */
export function createOverlayState(ctx: { readonly config: Readonly<Config> }): OverlayState {
  return {
    mode: "hidden",
    last: "card",
    tab: "frames",
    place: { dock: ctx.config.dock, y: 1 },
    asked: undefined,
    started: false,
    more: false,
    selected: undefined,
    record: undefined,
    recordCopy: undefined,
    toast: undefined,
    busy: new Set(),
    markDraft: "",
    addressDraft: undefined,
    addressError: undefined,
    link: undefined,
    rec: undefined,
    hasBridge: false,
    host: undefined,
    root: undefined,
    container: undefined,
    probes: [],
    isolate: undefined,
    canvas: undefined,
    graph: undefined,
    graphView: { width: 0, height: 0, wide: false, selected: -1, leadPx: 0, layer: "plot" },
    fixed: undefined,
    fixedGraph: undefined,
    fixedView: { width: 0, height: 0, wide: false, selected: -1, layer: "fixed" },
    slide: { px: 0, at: 0, fromX: 0, toX: 0, durMs: 0, edgeMs: Number.NaN, toEdgeMs: Number.NaN },
    motionQuery: undefined,
    painted: { version: -1, row: -1, w: 0, h: 0, dpr: 0 },
    facts: {
      gpuAvg: undefined,
      gpuP50: undefined,
      gpuP90: undefined,
      total: 0,
      row: -1,
      ordinal: 0,
      count: 0,
      gpuTimer: true
    },
    probe: { x: 0, y: 0, dir: 1 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    viewport: { w: 0, h: 0 },
    tick: undefined,
    opening: false,
    drag: undefined,
    faces: undefined,
    channel: undefined,
    off: [],
    storageFailed: false,
    paintFailed: false
  };
}
