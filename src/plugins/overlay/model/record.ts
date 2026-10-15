/**
 * @file overlay plugin — the spike record's view model (C3): the lead (causes primary first, the
 * frame's ms against its own budget), the why line with "Also …", and the details. Pure.
 */
import { CAUSE_STYLE } from "../../perf/graph";
import type {
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfFrameEvent,
  PerfSpikeRecord
} from "../../perf/protocol";
import type { RecorderStatus } from "../../recorder/types";
import { logTime, oneDecimal, wholeText } from "./format";
import { navView } from "./frames";
import type { BarRow, KvRow, LegendView, RecordView } from "./types";

/** "Not measured" in a record row. */
const DASH = "—";

/** Milliseconds in a second. */
const SECOND_MS = 1000;

/** The widest mini bar, CSS px. */
const BAR_MAX = 40;

/** An upload this large is a caution, MB. */
const UPLOAD_CAUTION_MB = 1;

/** The slowest systems a record names. */
const TOP_SYSTEMS = 3;

/** The minus sign of a freed amount. */
const MINUS = "−";

/** How each change kind reads when the engine gave no subject. */
const CHANGE_TEXT: Readonly<Record<PerfChange, string>> = {
  resize: "resize",
  resolution: "resolution change",
  scene: "scene",
  bundle: "bundle loaded",
  restore: "device restored"
};

/**
 * The severity of a frame against its own budget: red over twice the budget, amber over it.
 *
 * @param ms - The frame time.
 * @param budget - The frame's own budget.
 * @returns "ok", "amber" or "red".
 * @example
 * ```ts
 * severityOf(33.5, 16.7); // "red"
 * ```
 */
export function severityOf(ms: number, budget: number): RecordView["severity"] {
  if (ms > budget * 2) return "red";
  return ms > budget ? "amber" : "ok";
}

/**
 * The cause legend of the record's lead.
 *
 * @param cause - The cause.
 * @param lit - The primary cause is lit.
 * @returns The legend.
 */
function causeLegend(cause: PerfCause, lit: boolean): LegendView {
  const style = CAUSE_STYLE[cause];
  return {
    text: style.legend,
    colour: style.hue,
    lit: lit && !style.hollow,
    hollow: style.hollow,
    title: style.key,
    small: style.hollow ? "likely" : undefined
  };
}

/**
 * The "Also …" sentence of a multi-cause spike: every cause after the primary, as its legend and
 * its word in lower case.
 *
 * @param causes - The causes, primary first.
 * @returns "Also LF, long frame; JS, work over budget." or "" for one cause.
 * @example
 * ```ts
 * alsoOf(["upload", "gap"]); // "Also GAP, pause without work."
 * ```
 */
export function alsoOf(causes: readonly PerfCause[]): string {
  const rest = causes.slice(1);
  if (rest.length === 0) return "";

  const parts = rest.map(cause => {
    const style = CAUSE_STYLE[cause];
    return `${style.legend}, ${style.word.toLowerCase()}`;
  });
  return `Also ${parts.join("; ")}.`;
}

/**
 * The game's frame event as "What changed" reads it.
 *
 * @param event - The frame event.
 * @returns The text.
 */
function eventText(event: PerfFrameEvent): string {
  switch (event.kind) {
    case "overlay": {
      return `${event.label} ${event.what}`;
    }
    case "pool-trim": {
      return `pool trim ${MINUS}${event.freedMb.toFixed(1)} MB (${event.reason})`;
    }
    default: {
      return `warm-up ${event.draws} draws`;
    }
  }
}

/**
 * One engine change as "What changed" reads it: with its subject once the spike line arrived.
 *
 * @param change - The change entry of the spike line.
 * @returns The text.
 * @example
 * ```ts
 * changeText({ kind: "bundle", what: "garden-boss" }); // "bundle garden-boss loaded"
 * ```
 */
function changeText(change: PerfChangeEntry): string {
  if (change.what === null) return CHANGE_TEXT[change.kind];
  if (change.kind === "bundle") return `bundle ${change.what} loaded`;
  return `${CHANGE_TEXT[change.kind]} ${change.what}`;
}

/**
 * The engine's changes of the frame: from the spike line (with subjects, and a structure rebuild)
 * once it arrived, else the ring's change kinds.
 *
 * @param record - The spike record.
 * @returns The texts, in order.
 */
function changeParts(record: PerfSpikeRecord): string[] {
  const frame = record.detail?.frame;
  if (frame === undefined) return record.changed.map(change => CHANGE_TEXT[change]);

  const parts = frame.changed.map(change => changeText(change));
  if (typeof frame.rebuilds === "number" && frame.rebuilds > 0) {
    parts.push(`structure rebuild ×${frame.rebuilds}`);
  }
  return parts;
}

/**
 * The rate switch of the frame, its reason and mode left out when unknown.
 *
 * @param rate - The record's rate switch.
 * @returns "rate 120 → 60 (missed, auto)"; nothing without a switch.
 * @example
 * ```ts
 * rateText({ from: 120, to: 60, reason: null, mode: null }); // ["rate 120 → 60"]
 * ```
 */
function rateText(rate: PerfSpikeRecord["rateSwitch"]): string[] {
  if (rate === null) return [];
  const why = [rate.reason, rate.mode].filter(part => typeof part === "string");
  const because = why.length > 0 ? ` (${why.join(", ")})` : "";
  return [`rate ${rate.from} → ${rate.to}${because}`];
}

/**
 * "What changed" in the frame: the engine's changes, the rate switch, then the game's frame events,
 * joined " · "; "—" when nothing changed.
 *
 * @param record - The spike record.
 * @returns The text, or "—".
 * @example
 * ```ts
 * changedText({ ...record, changed: [], rateSwitch: { from: 120, to: 60, reason: "missed", mode: "auto" } }); // "rate 120 → 60 (missed, auto)"
 * ```
 */
export function changedText(record: PerfSpikeRecord): string {
  const parts = [
    ...changeParts(record),
    ...rateText(record.rateSwitch),
    ...record.events.map(event => eventText(event))
  ];
  return parts.length === 0 ? DASH : parts.join(" · ");
}

/**
 * Mini bars: each value's width as a share of the largest, at most 40 px.
 *
 * @param rows - Label and value pairs.
 * @returns The bars.
 */
function barsOf(rows: readonly (readonly [string, number])[]): BarRow[] {
  const max = Math.max(0, ...rows.map(([, value]) => value));
  return rows.map(([label, value]) => ({
    label,
    value: oneDecimal(value),
    width: max > 0 ? Math.round((value / max) * BAR_MAX) : 0
  }));
}

/**
 * The phase bars: the spike line's phases once it arrived, else the ring's.
 *
 * @param record - The spike record.
 * @returns The bars; [] when neither has them.
 */
function phaseBars(record: PerfSpikeRecord): BarRow[] {
  const phases = record.detail?.frame.phases ?? record.phases;
  if (phases === null) return [];

  return barsOf([
    ["input", phases.input],
    ["animate", phases.animate],
    ["layout", phases.layout],
    ["sync", phases.sync],
    ["signals", phases.signals],
    ["render", phases.render],
    ["agent", phases.agent]
  ]);
}

/**
 * The long frame of the record: "none", "47 ms, <first script>", or "—" before the spike line.
 *
 * @param record - The spike record.
 * @returns The text.
 */
function longFrameText(record: PerfSpikeRecord): string {
  const detail = record.detail;
  if (detail === null) return DASH;

  const first = detail.longFrames[0];
  if (first === undefined) return "none";
  const script = first.scripts[0];
  const name = script === undefined ? "" : script.fn || script.source || script.invoker;
  return name === ""
    ? `${Math.round(first.durationMs)} ms`
    : `${Math.round(first.durationMs)} ms, ${name}`;
}

/**
 * The "This frame" rows: draws, uploads (amber from 1 MB), shader compiles, long frame, flow path
 * and the frame's rate.
 *
 * @param record - The spike record.
 * @returns The rows.
 */
function frameRows(record: PerfSpikeRecord): KvRow[] {
  const frame = record.detail?.frame;
  const uploads = frame === undefined ? record.uploads : frame.uploads;
  const compiles = record.detail === null ? record.compiles : record.detail.compiles.length;
  return [
    { label: "draws", value: wholeText(frame?.draws ?? record.draws), tone: "value" },
    {
      label: "uploads",
      value: uploads === null ? DASH : `${uploads.mb.toFixed(1)} MB`,
      tone: uploads !== null && uploads.mb >= UPLOAD_CAUTION_MB ? "caution" : "value"
    },
    { label: "shader compiles", value: wholeText(compiles), tone: "value" },
    { label: "long frame", value: longFrameText(record), tone: "word" },
    { label: "flow path", value: record.path, tone: "word" },
    { label: "rate", value: `${record.fps} fps`, tone: "word" }
  ];
}

/**
 * The "Filters, area" rows: megapixels per kind from the spike line, then the passes.
 *
 * @param record - The spike record.
 * @returns The rows.
 */
function filterRows(record: PerfSpikeRecord): KvRow[] {
  const detail = record.detail;
  const kinds: KvRow[] =
    detail === null
      ? []
      : detail.filters.map(filter => ({
          label: filter.kind,
          value: `${filter.mpx.toFixed(2)} Mpx`,
          tone: "word"
        }));
  const passes = detail === null ? record.passes : detail.passes.length;
  return [...kinds, { label: "passes", value: wholeText(passes), tone: "value" }];
}

/**
 * The slowest systems of the frame, from the spike line.
 *
 * @param record - The spike record.
 * @returns "frost-apply 2.6 · ripple 1.8 ms" or "—".
 */
function systemsOf(record: PerfSpikeRecord): string {
  const systems = record.detail?.systems ?? record.detail?.frame.systems ?? undefined;
  if (systems === undefined || systems === null || systems.length === 0) return DASH;

  const top = systems.toSorted((a, b) => b.ms - a.ms).slice(0, TOP_SYSTEMS);
  const named = top.map(system => `${system.name} ${system.ms.toFixed(1)}`);
  return `${named.join(" · ")} ms`;
}

/**
 * The record's meta line: how long ago, and the recording clock at the spike while recording
 * (left out before the recording started).
 *
 * @param record - The spike record.
 * @param rec - The recorder's status.
 * @returns "0.98 s ago, log 03:11.0".
 */
function metaOf(record: PerfSpikeRecord, rec: RecorderStatus | undefined): string {
  const ago = `${(record.agoMs / SECOND_MS).toFixed(2)} s ago`;
  if (rec?.state !== "recording") return ago;

  const at = rec.sinceMs - record.agoMs;
  return at < 0 ? ago : `${ago}, log ${logTime(at)}`;
}

/**
 * The spike record's view.
 *
 * @param record - `perf.spike(frame)` (or the copy kept after the spike left the window).
 * @param rec - The recorder's status (the log time).
 * @param ordinal - The spike's position in the window; 0 when it left.
 * @param total - Spikes in the window.
 * @returns The record view.
 */
export function recordView(
  record: PerfSpikeRecord,
  rec: RecorderStatus | undefined,
  ordinal: number,
  total: number
): RecordView {
  const also = alsoOf(record.causes);
  const gpu = record.detail?.passes ?? [];
  const passes = record.detail === null ? record.passes : record.detail.passes.length;
  return {
    frame: record.frame,
    title: `Frame ${record.frame}`,
    meta: metaOf(record, rec),
    nav: navView(total, ordinal),
    causes: record.causes.map((cause, index) => causeLegend(cause, index === 0)),
    word: CAUSE_STYLE[record.cause].word,
    ms: oneDecimal(record.ms),
    severity: severityOf(record.ms, record.budgetMs),
    over: `+${oneDecimal(record.ms - record.budgetMs)} ms`,
    budget: oneDecimal(record.budgetMs),
    why: also === "" ? record.why : `${record.why}. ${also}`,
    colour: CAUSE_STYLE[record.cause].hue,
    phases: phaseBars(record),
    gpuTitle:
      record.gpuMs === null
        ? "GPU —"
        : `GPU ${oneDecimal(record.gpuMs)} ms over ${wholeText(passes)} passes`,
    gpu: barsOf(gpu.map(pass => [pass.label ?? pass.kind, pass.gpuMs ?? 0])),
    systems: systemsOf(record),
    filters: filterRows(record),
    frameRows: frameRows(record),
    changed: changedText(record),
    pending: record.detail === null
  };
}
