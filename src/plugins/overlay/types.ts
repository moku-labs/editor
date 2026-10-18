/**
 * @file overlay plugin — type definitions: config, constants, the remembered window, the state,
 * the api (its contracts and examples live here, on the members), the global channel, the graph
 * seam, the domain context and the plugin context. View-model types live in `model/types.ts`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { AgentEvents, Require } from "../../config";
import type { GraphContext2D, GraphState, GraphView } from "../perf/graph";
import type { PerfSpikeRecord, PerfWindowView } from "../perf/protocol";
import type { PerfApi } from "../perf/types";
import type { RecorderApi, RecorderStatusEvent } from "../recorder/types";
import type { CommandVia, Effect, Json, RunResult } from "../registry/protocol";
import type { RegistryApi } from "../registry/types";

/**
 * The tick: numbers, text and canvas change at most 4 times a second.
 */
export const PAINT_MS = 250;

/**
 * The one-shot slide when the card or the pill opens, ms.
 */
export const SLIDE_MS = 120;

/**
 * How long a toast line stays, ms.
 */
export const TOAST_MS = 3000;

/**
 * Card width, CSS px.
 */
export const CARD_W = 344;

/**
 * Card width on a viewport narrower than `COMPACT_BELOW`, CSS px.
 */
export const CARD_W_COMPACT = 300;

/**
 * Viewport CSS width below which the card is compact.
 */
export const COMPACT_BELOW = 384;

/**
 * Card height, CSS px: `min(CARD_H, max(CARD_H_MIN, round(0.45 × viewport height)))`.
 */
export const CARD_H = 372;

/**
 * The least card height (a landscape phone), CSS px.
 */
export const CARD_H_MIN = 240;

/**
 * Pill width, CSS px.
 */
export const PILL_W = 138;

/**
 * Pill height, CSS px; its hit area extends 5 px on every side.
 */
export const PILL_H = 36;

/**
 * Space between the window and the top / bottom safe inset, CSS px.
 */
export const EDGE_GAP = 8;

/**
 * Pointer travel in CSS px before a grip press counts as a drag.
 */
export const DRAG_SLOP = 4;

/**
 * CSS px one arrow key moves the window.
 */
export const KEY_STEP = 16;

/**
 * localStorage key of the remembered window.
 */
export const STORE_KEY = "moku-editor:overlay";

/**
 * z-index of the host.
 */
export const Z_INDEX = 2_147_483_000;

/**
 * The attribute that marks the host element. It lives in the protocol, so the bridge's tap watch
 * reads the same marker; re-exported here for `Overlay.*`.
 */
export { HOST_ATTRIBUTE } from "../registry/protocol";

/**
 * The three modes of the window: nothing drawn, the small pill, the card.
 */
export type OverlayMode = "hidden" | "pill" | "card";

/**
 * The two visible modes; `open({ mode })` takes one of them.
 */
export type VisibleMode = "pill" | "card";

/**
 * The tabs of the card. "game" exists only when the game registered overlay commands.
 */
export type OverlayTab = "frames" | "game" | "record" | "link";

/**
 * The screen edge the window docks to.
 */
export type Dock = "left" | "right";

/**
 * The payload of `overlay:changed`.
 *
 * @example
 * ```ts
 * const changed: OverlayChanged = { mode: "card", tab: "frames" };
 * ```
 */
export type OverlayChanged = { readonly mode: OverlayMode; readonly tab: OverlayTab };

/**
 * Overlay configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, overlay: { mode: "pill", dock: "left" } } });
 * ```
 */
export type Config = {
  /**
   * Mode at start when the device remembers none (or `remember` is false). The engine's
   * `config.debug.overlay` opens the window later through `__MOKU_GAME_OVERLAY__.open({ mode })`.
   * Default "hidden".
   */
  mode: OverlayMode;
  /** Edge the window docks to until the person drags it. Default "right". */
  dock: Dock;
  /** Remember place, mode and tab on the device (localStorage). Default true. */
  remember: boolean;
  /** CSS selector of the element the host is appended to; undefined = document.body. */
  mount: string | undefined;
};

/**
 * Where the window sits: the edge and the vertical position as a share of the free range
 * (0 = top, 1 = bottom), so it survives a rotation.
 *
 * @example
 * ```ts
 * const place: Place = { dock: "right", y: 1 }; // the default: docked right, at the bottom
 * ```
 */
export type Place = { readonly dock: Dock; readonly y: number };

/**
 * The safe area in CSS px.
 *
 * @example
 * ```ts
 * const insets: Insets = { top: 32, right: 0, bottom: 24, left: 0 };
 * ```
 */
export type Insets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

/**
 * The CSS size of the page's viewport.
 *
 * @example
 * ```ts
 * const viewport: Viewport = { w: 384, h: 833 };
 * ```
 */
export type Viewport = { readonly w: number; readonly h: number };

/**
 * The box of the window in a mode; `compact` for the narrow card.
 *
 * @example
 * ```ts
 * const size: WindowSize = { w: 344, h: 372, compact: false };
 * ```
 */
export type WindowSize = { readonly w: number; readonly h: number; readonly compact: boolean };

/**
 * What `localStorage["moku-editor:overlay"]` holds (JSON).
 *
 * @example
 * ```ts
 * const stored: StoredOverlay = { v: 1, mode: "pill", last: "pill", tab: "record", place: { dock: "left", y: 0 } };
 * ```
 */
export type StoredOverlay = {
  readonly v: 1;
  readonly mode: OverlayMode;
  readonly last: VisibleMode;
  readonly tab: OverlayTab;
  readonly place: Place;
};

/**
 * One command of the game shown on the Game tab.
 *
 * @example
 * ```ts
 * const glow: OverlayCommand = { id: "garden.glow", title: "Glow", kind: "toggle", value: false, effect: "cosmetic", allowed: true, reason: undefined };
 * ```
 */
export type OverlayCommand = {
  readonly id: string;
  readonly title: string;
  readonly kind: "toggle" | "button";
  /** A toggle's current value (`value(app)` of the engine command); undefined for a button. */
  readonly value: boolean | undefined;
  readonly effect: Effect;
  /**
   * False when this build refuses it: a route / cheat / raw command on a read-only page (a
   * `--debug` build of an engine before `--debug` included control, or a `--debug=read` build).
   */
  readonly allowed: boolean;
  /** Why not, when not allowed: "needs a debug build of a newer engine, or without --debug=read". */
  readonly reason: string | undefined;
};

/**
 * A font face as the overlay registers it (the platform FontFace is one).
 */
export type FontFaceLike = { load(): Promise<unknown> };

/**
 * One bundled font face: its family, weight and the woff2 bytes as base64.
 *
 * @example
 * ```ts
 * const face: FaceSource = { family: "Barlow Condensed", weight: 600, base64: "d09GMgABAAAA…" };
 * ```
 */
export type FaceSource = {
  readonly family: string;
  readonly weight: number;
  readonly base64: string;
};

/**
 * The object the overlay sets as `globalThis.__MOKU_GAME_OVERLAY__` (engine spec 12 H4.1).
 *
 * @example
 * ```ts
 * // The engine's app.debug.overlay.toggle() calls it.
 * globalThis.__MOKU_GAME_OVERLAY__?.toggle();
 * ```
 */
export type OverlayChannel = {
  open(options?: { mode?: "pill" | "card" }): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
};

/**
 * One toast line of the Game or Record tab.
 */
export type Toast = {
  readonly text: string;
  readonly tone: "info" | "error";
  /** Epoch ms after which the tick drops it. */
  readonly until: number;
};

/**
 * The payload of the global `bridge:status`.
 */
export type LinkPayload = AgentEvents["bridge:status"];

/**
 * The canvas while the graph shows: the element, its 2D context, its CSS size (from a
 * ResizeObserver) and the dpr of its backing store.
 */
export type GraphCanvas = {
  readonly element: HTMLCanvasElement;
  readonly g: GraphContext2DLike;
  /** The well's CSS width (the visible width; the canvas is painted wider by the slide). */
  w: number;
  h: number;
  /** The dpr of the backing store. */
  dpr: number;
  /** The dpr the next paint uses (read on the tick). */
  nextDpr: number;
  /** The next paint slides (no reduced motion on the page or in the game). */
  motion: boolean;
  /** The ResizeObserver following the well's size; disconnected when the canvas is dropped. */
  observer: ResizeObserver | undefined;
};

/**
 * The fixed canvas while the graph shows: laid over the whole well, it does not slide (the tape and
 * its readout, the caption, `now`, the stack legend). Its size and dpr are those of its backing store
 * (0 before the first paint).
 */
export type FixedCanvas = {
  readonly element: HTMLCanvasElement;
  readonly g: GraphContext2DLike;
  /** CSS width of the backing store: the well's. */
  w: number;
  h: number;
  dpr: number;
};

/**
 * The slide of the last paint (Delta 2026-10-18): one linear transition of the plot canvas from
 * `fromX` to `toX` (translateX, CSS px) over `durMs` from `at` (Date.now()), showing the data's time
 * `edgeMs` at the well's right edge at its start and `toEdgeMs` at its end. `px` is 0 when the paint
 * slides nothing.
 */
export type Slide = {
  px: number;
  at: number;
  fromX: number;
  toX: number;
  durMs: number;
  edgeMs: number;
  toEdgeMs: number;
};

/**
 * The 2D context the overlay paints on: the painter's structural context plus the dpr transform.
 */
export type GraphContext2DLike = GraphContext2D & {
  clearRect(x: number, y: number, width: number, height: number): void;
  setTransform(
    scaleX: number,
    skewY: number,
    skewX: number,
    scaleY: number,
    moveX: number,
    moveY: number
  ): void;
};

/**
 * What the last paint drew: the painter skips a paint that would draw the same.
 */
export type Painted = { version: number; row: number; w: number; h: number; dpr: number };

/**
 * What the count visitor read from the window for the view: the GPU headline, spikes, the row and
 * ordinal of the selected frame (or the open record's), the rows and whether the page has a GPU
 * timer.
 */
export type WindowFacts = {
  /** The mean GPU time, from an agent before spec 03 delta item 8 (no p50 / p90); else undefined. */
  gpuAvg: number | undefined;
  /** The window's GPU p50 and p90 (spec 03 delta item 8), ms; undefined without them. */
  gpuP50: number | undefined;
  gpuP90: number | undefined;
  total: number;
  row: number;
  ordinal: number;
  count: number;
  gpuTimer: boolean;
};

/**
 * The input of the hit and nav visitors: the tap point and the step direction.
 */
export type Probe = { x: number; y: number; dir: 1 | -1 };

/**
 * The drag of the grip in progress.
 */
export type Drag = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly top: number;
  moved: boolean;
};

/**
 * Overlay state (private).
 */
export type OverlayState = {
  mode: OverlayMode;
  /** The mode `toggle()` returns to from hidden. */
  last: VisibleMode;
  tab: OverlayTab;
  place: Place;
  /** A mode asked for by `open`/`close`/`toggle` before start; wins over the remembered one at start. */
  asked: OverlayMode | undefined;
  /** onStart ran (with or without a document). */
  started: boolean;
  /** The More disclosure (closed by default; not remembered). */
  more: boolean;
  /** Frame number selected on the graph; undefined = the newest frame. */
  selected: number | undefined;
  /** Frame number of the open spike record on the Frames tab; undefined = the graph. */
  record: number | undefined;
  /** The last record shown, kept when its spike leaves the 6 s window. */
  recordCopy: PerfSpikeRecord | undefined;
  toast: Toast | undefined;
  /** Overlay command ids whose run has not settled. */
  busy: Set<string>;
  /** The mark label field. */
  markDraft: string;
  /** The address field; undefined = show the bridge's address. */
  addressDraft: string | undefined;
  addressError: string | undefined;
  /** The last bridge:status payload; undefined before the first. */
  link: LinkPayload | undefined;
  /** The last recorder:status payload (the recorder's per-plugin event); undefined before the first. */
  rec: RecorderStatusEvent | undefined;
  hasBridge: boolean;
  host: HTMLElement | undefined;
  root: ShadowRoot | undefined;
  /** The element Preact renders into, inside the shadow root. */
  container: HTMLElement | undefined;
  /** The two safe-area probes. */
  probes: readonly HTMLElement[];
  isolate: ((event: Event) => void) | undefined;
  /** The plot canvas while the graph shows (it slides). */
  canvas: GraphCanvas | undefined;
  /** The painter's state of this canvas (perf/graph `GraphState`), made with the canvas, dropped with it. */
  graph: GraphState | undefined;
  /** The view handed to the painter, rewritten before each paint (no allocation per paint). */
  readonly graphView: {
    width: number;
    height: number;
    wide: boolean;
    selected: number;
    leadPx: number;
    /** The plot's right edge: the window's newest data (Delta 2026-10-18). */
    nowMs: number;
    /**
     * The time the visible width spans: the window's span less the slide's room, so the canvas,
     * painted that much wider, holds the whole window and its left edge never shows a blank strip.
     */
    spanMs: number;
    readonly layer: "plot";
  };
  /** The fixed canvas while the graph shows (it does not slide). */
  fixed: FixedCanvas | undefined;
  /** The painter's state of the fixed canvas, made at its first paint, dropped with it. */
  fixedGraph: GraphState | undefined;
  /** The view handed to the painter for the fixed canvas, rewritten before each paint. */
  readonly fixedView: {
    width: number;
    height: number;
    wide: boolean;
    selected: number;
    readonly layer: "fixed";
  };
  /** The compositor slide of the last paint (spec 08 Delta 2026-10-15). */
  readonly slide: Slide;
  /** The page's `prefers-reduced-motion: reduce` query, made at the first paint. */
  motionQuery: { readonly matches: boolean } | undefined;
  readonly painted: Painted;
  readonly facts: WindowFacts;
  readonly probe: Probe;
  insets: Insets;
  viewport: Viewport;
  tick: ReturnType<typeof setInterval> | undefined;
  /** True from an opening until the slide ended (or the next tick). */
  opening: boolean;
  drag: Drag | undefined;
  /** Registered font faces (undefined until the first visible mode). */
  faces: readonly FontFaceLike[] | undefined;
  /** The object set on globalThis.__MOKU_GAME_OVERLAY__, to delete only our own on stop. */
  channel: OverlayChannel | undefined;
  /** Removers of window listeners and observers. */
  off: (() => void)[];
  /** A storage failure was logged (once). */
  storageFailed: boolean;
  /** A paint failure was logged (once). */
  paintFailed: boolean;
};

/**
 * The overlay api (`app.overlay`): the editor's window over the running game. The engine's
 * `app.debug.overlay.*` reaches it through `globalThis.__MOKU_GAME_OVERLAY__`; the tools page and
 * MCP through the `editor.overlay` command.
 */
export type OverlayApi = {
  /**
   * Shows the window: the card, or the pill with `{ mode: "pill" }`; `tab` picks the card's tab
   * ("game" falls back to "frames" when the game registered no overlay commands). Slides in once
   * (120 ms) when it was hidden, or from the pill to the card. Emits `overlay:changed` when the
   * mode or the tab changed. Before start it only records the mode; `onStart` applies it over the
   * remembered one. Idempotent.
   *
   * @param options - The visible mode and the tab.
   * @param options.mode - "pill" or "card" (default "card").
   * @param options.tab - The card's tab (default: the current one).
   * @example
   * ```ts
   * // A game's own "Perf" button in its debug menu, through the engine's app.debug.overlay.open():
   * app.overlay.open({ mode: "pill" });
   * app.overlay.mode(); // "pill"
   * ```
   */
  open(options?: { readonly mode?: VisibleMode; readonly tab?: OverlayTab }): void;
  /**
   * Hides the window: nothing of the editor stays on the game, the tick stops. Emits
   * `overlay:changed` when it was visible. Idempotent.
   *
   * @example
   * ```ts
   * // Before a screenshot of the game alone.
   * app.overlay.close();
   * app.overlay.isOpen(); // false
   * ```
   */
  close(): void;
  /**
   * Hidden → the last visible mode (the card by default); pill or card → hidden.
   *
   * @example
   * ```ts
   * // Five taps on the version line (the engine's DebugTrigger) call this through app.debug.overlay.toggle().
   * app.overlay.toggle();
   * app.overlay.mode(); // "card" the first time; "pill" when the pill was the last visible mode
   * ```
   */
  toggle(): void;
  /**
   * Whether the window shows, as the pill or the card.
   *
   * @returns True for "pill" and "card".
   * @example
   * ```ts
   * app.overlay.isOpen(); // false on a fresh start with nothing remembered
   * ```
   */
  isOpen(): boolean;
  /**
   * The current mode.
   *
   * @returns "hidden", "pill" or "card".
   * @example
   * ```ts
   * // The window was collapsed to the pill with its header key.
   * app.overlay.mode(); // "pill"
   * ```
   */
  mode(): OverlayMode;
  /**
   * The game's commands marked for the overlay, in manifest order, with a toggle's value read now.
   * Empty: the card has no Game tab.
   *
   * @returns Fresh copies.
   * @example
   * ```ts
   * // A Memory Missing on a read-only build (an older engine's `--debug`, or `--debug=read`).
   * app.overlay.commands().map(command => [command.id, command.value, command.allowed]);
   * // [["garden.glow", false, true], ["garden.fog", false, true], ["story.skipDialogue", undefined, false]]
   * ```
   */
  commands(): readonly OverlayCommand[];
};

/**
 * The painter seam of the domain context: `perf/graph` in the app, spies in tests (happy-dom has
 * no 2D context).
 */
export type GraphSeam = {
  /** The canvas's 2D context; undefined when the page has none. */
  readonly context: (canvas: HTMLCanvasElement) => GraphContext2DLike | undefined;
  readonly paint: (
    g: GraphContext2D,
    window: PerfWindowView,
    view: GraphView,
    state: GraphState
  ) => void;
  readonly spikeAt: (state: GraphState, window: PerfWindowView, x: number, y: number) => number;
  readonly rowAt: (state: GraphState, window: PerfWindowView, x: number) => number;
  readonly createState: (capacity: number) => GraphState;
  /** The CSS px a time covers at the scale of a window painted at a visible width (perf/graph `msToPx`). */
  readonly msToPx: (window: PerfWindowView, width: number, wide: boolean, ms: number) => number;
  readonly resetText: (state: GraphState) => void;
};

/**
 * The visitors the overlay hands to `perf.readWindow`, made once per domain context: they read
 * their inputs from the overlay state and write their answers to it.
 */
export type Visitors = {
  /** Paints the graph when the window, the selection or the size changed. */
  readonly paint: (window: PerfWindowView) => void;
  /** Steps the selection or the open record to the previous / next spike (`state.probe.dir`). */
  readonly nav: (window: PerfWindowView) => void;
  /** Opens the record of a tapped spike, or selects the tapped frame (`state.probe.x/y`). */
  readonly hit: (window: PerfWindowView) => void;
  /** Writes the window facts the view shows (`state.facts`). */
  readonly count: (window: PerfWindowView) => void;
};

/**
 * The overlay's own events: the two global agent events it emits.
 */
export type OverlayEvents = Pick<AgentEvents, "overlay:changed" | "overlay:connect">;

/**
 * The registry members the overlay reads.
 */
export type OverlayRegistry = Pick<
  RegistryApi,
  "manifest" | "add" | "envelope" | "build" | "game"
> & {
  command(id: string): { value?(): boolean | undefined } | undefined;
};

/**
 * The channel member the overlay runs commands through (the third argument names the source).
 */
export type OverlayRunner = {
  run(id: string, input?: Json, via?: CommandVia): Promise<RunResult>;
};

/**
 * Domain context of the overlay modules (unit tests pass a plain object).
 */
export type OverlayCtx = {
  readonly config: Readonly<Config>;
  state: OverlayState;
  readonly log: Log.LogApi;
  readonly emit: EmitFn<OverlayEvents>;
  readonly registry: OverlayRegistry;
  readonly channel: OverlayRunner;
  readonly perf: Pick<PerfApi, "status" | "readWindow" | "second" | "spike" | "monitor">;
  readonly recorder: Pick<
    RecorderApi,
    "status" | "start" | "stop" | "mark" | "command" | "marks" | "files" | "share" | "remove"
  >;
  readonly graph: GraphSeam;
  readonly visitors: Visitors;
};

/**
 * Plugin context of the overlay: the kernel context is assignable to it.
 */
export type OverlayPluginCtx = {
  readonly config: Readonly<Config>;
  state: OverlayState;
  readonly log: Log.LogApi;
  readonly emit: EmitFn<OverlayEvents>;
  readonly require: Require;
  readonly has: (name: string) => boolean;
};

/**
 * The teardown context of the overlay's onStop: own state only (no emit, no log).
 */
export type OverlayStopCtx = { state: OverlayState };

/**
 * The overlay's hooks: the global bridge:status and the recorder's per-plugin recorder:status.
 */
export type OverlayHooks = {
  readonly "bridge:status": (payload: LinkPayload) => void;
  readonly "recorder:status": (payload: RecorderStatusEvent) => void;
};
