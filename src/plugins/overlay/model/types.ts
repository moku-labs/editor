/**
 * @file overlay plugin — the view-model types: what the pure `model/` functions answer and the
 * Preact views draw. Plain data; colours are CSS values for the `--c` custom property.
 */
import type { Dock, OverlayMode, OverlayTab } from "../types";

/**
 * An annunciator legend: boxed text in a colour; lit = filled, hollow = dashed.
 */
export type LegendView = {
  readonly text: string;
  /** A CSS colour for `--c`: a token (`var(--live)`) or a cause hue. */
  readonly colour: string;
  readonly lit: boolean;
  readonly hollow: boolean;
  readonly title: string | undefined;
  /** The small word after the text ("likely" for GC?). */
  readonly small: string | undefined;
};

/**
 * The link legend of the header and the pill.
 */
export type LinkLegend = {
  readonly kind: "none" | "connecting" | "adb" | "lan" | "dev";
  readonly text: string;
  readonly colour: string;
};

/**
 * The card header (B1); the pill (C1) draws the same numbers.
 */
export type HeaderView = {
  /** Drawn fps of the last second, "idle" while the screen rests, or "—". */
  readonly fps: string;
  /** The word after it: "fps", or how long the screen has rested ("12s"; "" when unknown). */
  readonly fpsUnit: string;
  /**
   * The compact card's header (spec 08 delta item 8): the fps without its unit, no spikes label,
   * REC as a red dot and its time.
   */
  readonly compact: boolean;
  /** How long the recorder has recorded ("3m"); "" when it does not record. */
  readonly recFor: string;
  /** Spikes in the window. */
  readonly spikes: number;
  readonly link: LinkLegend;
  readonly stale: boolean;
  readonly rec: boolean;
};

/**
 * The engine line (B3).
 */
export type EngineLineView = {
  readonly engine: string;
  readonly build: string;
  readonly profile: string;
  readonly stale: boolean;
};

/**
 * The rate suffix of the drawn / loop counter: `@120`.
 */
export type RateSuffix = {
  readonly text: string;
  readonly caution: boolean;
  readonly title: string;
};

/**
 * One counter cell of the Frames tab.
 */
export type CounterCell = {
  readonly key: "fps" | "p90" | "gpu" | "passes" | "draws" | "texture" | "device" | "heap";
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  /** Columns of the 12-column grid. */
  readonly span: 3 | 4 | 6;
  readonly caution: boolean;
  readonly rate: RateSuffix | undefined;
  /** Where the rate suffix sits: after the value, or on the label line (the compact card, where the value cell is too narrow). */
  readonly ratePlace: "value" | "label";
  /** The cell's tooltip: the rate's mode; on the compact card also the "drawn / loop" its short label leaves out. */
  readonly title: string | undefined;
};

/**
 * One part of the More text: `label <b>value</b>rest`.
 */
export type MorePart = { readonly label: string; readonly value: string; readonly rest: string };

/**
 * The prev / next counter: `5/6`, `–/6`.
 */
export type NavView = { readonly counter: string; readonly disabled: boolean };

/**
 * One mini bar of the spike record (phases, GPU passes).
 */
export type BarRow = { readonly label: string; readonly value: string; readonly width: number };

/**
 * One key / value row of the spike record.
 */
export type KvRow = {
  readonly label: string;
  readonly value: string;
  /** "value" cyan, "word" ink, "caution" amber. */
  readonly tone: "value" | "word" | "caution";
};

/**
 * The spike record (C3).
 */
export type RecordView = {
  readonly frame: number;
  readonly title: string;
  readonly meta: string;
  readonly nav: NavView;
  readonly causes: readonly LegendView[];
  readonly word: string;
  readonly ms: string;
  readonly severity: "ok" | "amber" | "red";
  readonly over: string;
  readonly budget: string;
  readonly why: string;
  /** The primary cause's hue: the why line's left rule. */
  readonly colour: string;
  readonly phases: readonly BarRow[];
  readonly gpuTitle: string;
  readonly gpu: readonly BarRow[];
  readonly systems: string;
  readonly filters: readonly KvRow[];
  readonly frameRows: readonly KvRow[];
  readonly changed: string;
  /** The engine's spike line has not arrived yet. */
  readonly pending: boolean;
};

/**
 * The Frames tab (C2, C7, C8, D1).
 */
export type FramesView = {
  readonly state: "graph" | "waiting" | "off" | "record";
  readonly note: string | undefined;
  readonly gpuTimer: boolean;
  readonly compact: boolean;
  readonly nav: NavView;
  /** Device mode with no computer: the offline note (F4). */
  readonly offline: boolean;
  readonly counters: readonly CounterCell[];
  readonly more: boolean;
  readonly systems: string;
  readonly parts: readonly MorePart[];
  readonly record: RecordView | undefined;
};

/**
 * A toast line (F2).
 */
export type ToastView = { readonly text: string; readonly tone: "info" | "error" };

/**
 * One row of the Game tab.
 */
export type GameRow = {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly state: "on" | "off" | "run" | "busy" | "refused";
  readonly legend: "ON" | "OFF" | "RUN";
  readonly toggle: boolean;
  readonly pressed: boolean | undefined;
  readonly disabled: boolean;
  readonly title: string | undefined;
};

/**
 * The Game tab (C4).
 */
export type GameView = {
  readonly by: string;
  readonly rows: readonly GameRow[];
  readonly readOnly: boolean;
  readonly toast: ToastView | undefined;
};

/**
 * One log of the Record tab.
 */
export type LogRow = {
  readonly name: string;
  readonly size: string;
  readonly time: string;
  readonly status: "current" | "sent" | "partial";
  readonly statusText: string;
  readonly canDelete: boolean;
};

/**
 * The "Sent to the computer" line: linked (with the meter) or offline.
 */
export type SentView = {
  readonly linked: boolean;
  readonly sent: string;
  readonly pending: string;
  /** Meter width as a share, 0–1. */
  readonly share: number;
};

/**
 * The Record tab (C5).
 */
export type RecordTabView = {
  readonly recording: boolean;
  readonly legend: LegendView;
  readonly clock: string;
  readonly dim: boolean;
  /** The two info lines: the numbers while recording, else the idle words. */
  readonly stats: readonly { readonly value: string; readonly text: string }[];
  /** Who started the log ("started here", "started by an agent (Claude)"); undefined while idle. */
  readonly origin: string | undefined;
  readonly key: {
    readonly action: "start" | "stop";
    readonly label: "Start" | "Stop";
    readonly disabled: boolean;
    readonly title: string | undefined;
  };
  readonly sent: SentView | undefined;
  readonly draft: string;
  readonly marks: readonly {
    readonly time: string;
    readonly label: string;
    readonly auto: boolean;
  }[];
  readonly files: readonly LogRow[];
  readonly toast: ToastView | undefined;
};

/**
 * One mode key of the Link tab.
 */
export type ModeKey = {
  readonly kind: "none" | "connecting" | "adb" | "lan";
  readonly word: string;
  readonly sub: string;
  readonly colour: string;
  readonly lit: boolean;
  readonly candidate: boolean;
};

/**
 * The address row of the Link tab.
 */
export type AddressRow = {
  readonly value: string;
  readonly placeholder: string;
  readonly readOnly: boolean;
  readonly action: "connect" | "pair" | undefined;
  readonly tag: string | undefined;
  readonly disabled: boolean;
};

/**
 * The Link tab (C6, F3).
 */
export type LinkTabView = {
  readonly keys: readonly ModeKey[];
  readonly address: AddressRow | undefined;
  readonly error: string | undefined;
  readonly pairing: string | undefined;
  readonly caution: { readonly phone: string; readonly computer: string } | undefined;
  readonly live: { readonly title: string; readonly text: string } | undefined;
  /** The engine line inline under the live box. */
  readonly engineInline: boolean;
  readonly seen: { readonly value: string; readonly rest: string } | undefined;
  readonly note: string | undefined;
};

/**
 * Everything the overlay draws (pure output of `viewOf`).
 */
export type OverlayView = {
  readonly mode: OverlayMode;
  readonly dock: Dock;
  readonly compact: boolean;
  readonly header: HeaderView;
  readonly pillLabel: string;
  readonly tabs: readonly OverlayTab[];
  readonly tab: OverlayTab;
  readonly engine: EngineLineView;
  readonly frames: FramesView | undefined;
  readonly game: GameView | undefined;
  readonly record: RecordTabView | undefined;
  readonly link: LinkTabView | undefined;
};
