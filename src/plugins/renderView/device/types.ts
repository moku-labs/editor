/**
 * @file renderView device strip — type definitions of the `device/` sub-domain (spec 09 R1): the
 * strip's state and record panel state, the derived view the api hands out, and the text runs,
 * cells and record rows the components render. Wire shapes come only through `./contract` (perf
 * and recorder) and `hub/protocol` (`SessionDevice`), all `import type`.
 */
import type { SessionDevice } from "../../hub/protocol";
import type { PerfCause } from "../../perf/protocol";
import type {
  PerfSecond,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfWindow,
  RecorderStatus
} from "./contract";

/**
 * The record side panel: closed, or the record of one spike frame and how far its read got.
 *
 * @example
 * ```ts
 * const state: RecordState = { kind: "gone", frame: 4572 };
 * ```
 */
export type RecordState =
  | { readonly kind: "closed" }
  | { readonly kind: "loading"; readonly frame: number }
  | { readonly kind: "shown"; readonly frame: number; readonly record: PerfSpikeRecord }
  | { readonly kind: "gone"; readonly frame: number }
  | { readonly kind: "failed"; readonly frame: number; readonly message: string };

/**
 * The device strip's data and UI state (part of RenderViewState).
 */
export type DeviceStripState = {
  /**
   * The session the data belongs to: a device session (01's `SessionDevice`) or a browser
   * session (`device` undefined); undefined while the chosen session's manifest lists no
   * `editor.perf.second`.
   */
  session: { readonly id: string; readonly device: SessionDevice | undefined } | undefined;
  /** The last `editor.perf.second` value; undefined before the first. */
  second: PerfSecond | undefined;
  /** Date.now() when `second` arrived: "seen N s ago". */
  secondAt: number | undefined;
  /** The strip's own window, allocated once and filled from each `editor.perf.window` value. */
  readonly window: PerfWindow;
  /** The last `editor.perf.spikes` value, oldest first; [] before the first. */
  spikes: readonly PerfSpikeSummary[];
  /** The last `editor.recorder` value; undefined when the agent has no recorder source. */
  recorder: RecorderStatus | undefined;
  /** Whether the manifest lists `editor.perf.window` available: "absent" for an agent without perf. */
  perf: "listed" | "absent";
  /** The frame the readout box rides on (a spike or any frame); undefined: none (the newest). */
  selected: number | undefined;
  /** The side panel. */
  record: RecordState;
  /** More is open: true on the strip by default (design §4 "More disclosure"). */
  more: boolean;
  /** A value arrived (or the selection moved) since the last paint. */
  dirty: boolean;
  /** Unwatch of the perf and recorder sources; empty while Render is hidden or the session has no perf. */
  watches: (() => void)[];
  /** The frame whose record read is in flight, to drop a late answer for a record closed or replaced since. */
  reading: number | undefined;
  /** Stops the repaint loop of the mounted canvas (its two intervals); undefined while none runs. */
  stopPaint: (() => void) | undefined;
};

/**
 * What the strip shows, derived (copies); the same data the components render.
 *
 * @example
 * ```ts
 * app.renderView.device()?.engine; // { device: "0.14.12+9c41e0", computer: "0.14.13+1ab7f2", stale: true }
 * ```
 */
export type DeviceStripView = {
  readonly session: string;
  /**
   * How the agent reached the hub: a phone over adb or the LAN, from where (01 `SessionDevice`);
   * or the game page in the editor's frame (`browser`: no address, no port, no pairing).
   */
  readonly link:
    | { readonly kind: "adb" | "lan"; readonly address: string; readonly port: number }
    | { readonly kind: "browser" };
  /** Whole seconds since the last perf value; undefined before the first. */
  readonly seenSeconds: number | undefined;
  /** "absent": the agent has no perf; "no-monitor": perf found no monitor; "waiting": no value yet; "live". */
  readonly perf: "absent" | "no-monitor" | "waiting" | "live";
  readonly model: string | undefined;
  /** "Android 15, WebView 131, 60 Hz, dpr 2.81": the known parts only, joined by ", ". */
  readonly about: string;
  readonly backend: "webgpu" | "webgl" | "none" | undefined;
  /** The loop's rate now (the `@120` suffix of drawn / loop); undefined before the first value or without a rate. */
  readonly rate:
    | {
        readonly fps: number;
        readonly mode: "fixed" | "auto" | "forced" | undefined;
        readonly reason: string | undefined;
        readonly fellBack: boolean;
      }
    | undefined;
  readonly engine: {
    readonly device: string | undefined;
    readonly computer: string | undefined;
    readonly stale: boolean;
  };
  readonly build: {
    readonly id: string | undefined;
    readonly profile: "dev" | "debug, read-only" | "debug, full" | undefined;
  };
  /** undefined when the agent has no recorder source. */
  readonly rec:
    | { readonly state: "idle" | "recording" | "exporting"; readonly clock: string | undefined }
    | undefined;
  /** Spike frames on the graph, oldest first, with their primary cause (03's `cause`). */
  readonly spikes: readonly { readonly frame: number; readonly cause: PerfCause }[];
  readonly selected: number | undefined;
  /** "5/6", "–/6" when the selection is not a spike, "0/0" without spikes. */
  readonly counter: string;
  readonly record: RecordState["kind"];
  /** The frame of the record panel; undefined while closed. */
  readonly recordFrame: number | undefined;
  readonly more: boolean;
};

/**
 * How a run of strip text reads: plain ink-2, a measured value (600 cyan) or a warning (amber).
 */
export type RunTone = "plain" | "value" | "warn";

/**
 * One run of strip text, with an optional tooltip.
 *
 * @example
 * ```ts
 * const run: StripRun = { text: "@60", tone: "warn", title: "60 fps, auto, fell back (missed); display 120 Hz" };
 * ```
 */
export type StripRun = { readonly text: string; readonly tone: RunTone; readonly title?: string };

/**
 * A line of strip text: runs read left to right.
 */
export type StripLine = readonly StripRun[];

/**
 * The link cell of the device row: the outlined legend, its colour and the text after it.
 *
 * @example
 * ```ts
 * const cell: LinkCell = { legend: "ADB", tone: "green", text: "127.0.0.1:47600, seen 1 s ago" };
 * ```
 */
export type LinkCell = {
  readonly legend: "ADB" | "LAN" | "BROWSER";
  readonly tone: "green" | "amber" | "ink2";
  readonly text: string;
};

/**
 * The log cell of the device row: REC with its clock (lit red), EXPORTING or STOPPED (outlined).
 *
 * @example
 * ```ts
 * const cell: RecCell = { text: "REC 03:12", tone: "red", lit: true };
 * ```
 */
export type RecCell = {
  readonly text: string;
  readonly tone: "red" | "amber" | "ink2";
  readonly lit: boolean;
};

/**
 * One cause legend of a record's lead.
 */
export type CauseLegend = {
  readonly cause: PerfCause;
  readonly legend: string;
  readonly hue: string;
  /** The primary cause: filled. */
  readonly lit: boolean;
  /** GC?: dashed with "likely". */
  readonly hollow: boolean;
};

/**
 * A row with a bar in the record's details: label, value text and the bar's share of the largest.
 */
export type BarRow = { readonly label: string; readonly value: string; readonly share: number };

/**
 * A label and a value in the record's "This frame" list.
 */
export type ValueRow = { readonly label: string; readonly value: string; readonly tone: RunTone };

/**
 * The rows of the record side panel (design §7 order), derived from one record.
 */
export type RecordView = {
  /** "Frame 4812". */
  readonly title: string;
  /** "0.98 s ago, log 03:11.0". */
  readonly sub: string;
  readonly causes: readonly CauseLegend[];
  /** The primary cause's word: "Upload". */
  readonly word: string;
  /** "41.3". */
  readonly ms: string;
  /** "+24.6 ms over". */
  readonly over: string;
  /** "16.7": the frame's own budget. */
  readonly budget: string;
  /** Red when the frame took more than twice its budget, else amber. */
  readonly severity: "red" | "amber";
  readonly why: string;
  /** The primary cause's hue, for the why line's rule. */
  readonly hue: string;
  readonly phases: readonly BarRow[];
  /** "GPU 6.6 ms over 6 passes", or "GPU — no timer". */
  readonly gpuTitle: string;
  readonly passes: readonly BarRow[];
  /** "Slowest systems this frame": undefined when the record has none. */
  readonly systems: readonly BarRow[] | undefined;
  /** "Filters" rows: undefined when the frame applied none. */
  readonly filters: readonly ValueRow[] | undefined;
  readonly thisFrame: readonly ValueRow[];
  /** "What changed", joined by " · "; undefined when nothing changed. */
  readonly changed: string | undefined;
  /** "More detail arrives with the log line in about a second." while the engine's line is due. */
  readonly note: string | undefined;
};
