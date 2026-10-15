/**
 * @file renderView device strip — the rows of the spike record side panel (design §7 order, spec
 * 09 § Derivation rules: header, lead, why line, details), from one `PerfSpikeRecord` and the
 * recorder's clock. The same strings as the overlay's record (unit 08). Pure.
 */
import type { PerfCause } from "../../perf/protocol";
import type { PerfSpikeRecord, RecorderStatus } from "./contract";
import { CAUSE_STYLE } from "./contract";
import { DASH, whole } from "./derive";
import type { BarRow, CauseLegend, RecordView, ValueRow } from "./types";

/**
 * Milliseconds in a second.
 */
const MS_PER_SECOND = 1000;

/**
 * Seconds in a minute.
 */
const SECONDS_PER_MINUTE = 60;

/**
 * Milliseconds in a tenth of a second: the log clock shows tenths.
 */
const MS_PER_TENTH = 100;

/**
 * Tenths in a second.
 */
const TENTHS_PER_SECOND = 10;

/**
 * Uploads of this many MB or more in one frame are a caution (amber), as in the overlay's record.
 */
const UPLOAD_CAUTION_MB = 1;

/**
 * The phases of a frame, in the record's order.
 */
const PHASE_NAMES = ["input", "animate", "layout", "sync", "signals", "render", "agent"] as const;

/**
 * The note shown while the engine's spike line has not arrived yet.
 */
const DETAIL_NOTE = "More detail arrives with the log line in about a second.";

/**
 * The separator of "what changed".
 */
const CHANGE_SEPARATOR = " · ";

/**
 * A log clock with tenths: "03:11.0".
 *
 * @param ms - Milliseconds since the log started.
 * @returns "mm:ss.s".
 * @example
 * ```ts
 * logClock(191_020); // "03:11.0"
 * ```
 */
function logClock(ms: number): string {
  const tenths = Math.floor(ms / MS_PER_TENTH);
  const tenthsPerMinute = SECONDS_PER_MINUTE * TENTHS_PER_SECOND;
  const seconds = (tenths % tenthsPerMinute) / TENTHS_PER_SECOND;
  const minutes = Math.floor(tenths / tenthsPerMinute);
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/**
 * The header's sub-line: "0.98 s ago", plus ", log 03:11.0" while recording when the spike came
 * after the log's start.
 *
 * @param record - The record.
 * @param recorder - The recorder status; undefined without the source.
 * @returns The text.
 */
function subLine(record: PerfSpikeRecord, recorder: RecorderStatus | undefined): string {
  const ago = `${(record.agoMs / MS_PER_SECOND).toFixed(2)} s ago`;
  if (recorder?.state !== "recording") return ago;
  const at = recorder.sinceMs - record.agoMs;
  return at < 0 ? ago : `${ago}, log ${logClock(at)}`;
}

/**
 * The cause legends of the lead: every cause, primary first and lit, GC? hollow.
 *
 * @param record - The record.
 * @returns The legends.
 */
function legendsOf(record: PerfSpikeRecord): CauseLegend[] {
  const causes: PerfCause[] = [
    record.cause,
    ...record.causes.filter(cause => cause !== record.cause)
  ];
  return causes.map(cause => ({
    cause,
    legend: CAUSE_STYLE[cause].legend,
    hue: CAUSE_STYLE[cause].hue,
    lit: cause === record.cause,
    hollow: CAUSE_STYLE[cause].hollow
  }));
}

/**
 * Bar rows scaled to the largest value.
 *
 * @param entries - Label and value of each row (null: not measured).
 * @returns The rows; a value of null reads "—" with no bar.
 */
function barsOf(entries: readonly { label: string; ms: number | null }[]): BarRow[] {
  const largest = Math.max(0, ...entries.map(entry => entry.ms ?? 0));
  return entries.map(entry => ({
    label: entry.label,
    value: entry.ms === null ? DASH : entry.ms.toFixed(1),
    share: entry.ms === null || largest === 0 ? 0 : entry.ms / largest
  }));
}

/**
 * The phase bars: from the record, else from the engine's line.
 *
 * @param record - The record.
 * @returns The rows; [] when neither has the phases.
 */
function phaseRows(record: PerfSpikeRecord): BarRow[] {
  const phases = record.phases ?? record.detail?.frame.phases;
  if (phases === undefined || phases === null) return [];
  return barsOf(PHASE_NAMES.map(name => ({ label: name, ms: phases[name] })));
}

/**
 * The GPU column: its title and a bar per pass of the engine's line (the label, else the kind).
 *
 * @param record - The record.
 * @returns The title and the rows.
 */
function gpuColumn(record: PerfSpikeRecord): { title: string; rows: BarRow[] } {
  if (record.gpuMs === null) return { title: `GPU ${DASH} no timer`, rows: [] };
  const passes = record.detail?.passes;
  const count = passes?.length ?? record.passes;
  const over = count === null ? "" : ` over ${count} passes`;
  const rows = barsOf(
    (passes ?? []).map(pass => ({ label: pass.label ?? pass.kind, ms: pass.gpuMs }))
  );
  return { title: `GPU ${record.gpuMs.toFixed(1)} ms${over}`, rows };
}

/**
 * The slowest systems of the frame, from the engine's line; undefined when it has none.
 *
 * @param record - The record.
 * @returns The rows.
 */
function systemRows(record: PerfSpikeRecord): BarRow[] | undefined {
  const systems = record.detail?.systems;
  if (systems === null || systems === undefined || systems.length === 0) return undefined;
  const slowest = systems.toSorted((left, right) => right.ms - left.ms);
  return barsOf(slowest.map(system => ({ label: system.name, ms: system.ms })));
}

/**
 * The record's own filter total as one row of kind "all", for a record whose engine line has not
 * arrived: none when the frame applied no filter.
 *
 * @param total - `record.filters`: applies and Mpx of the frame, or null.
 * @returns The row, or none.
 * @example
 * ```ts
 * totalFilterRows({ applies: 4, mpx: 2.1 }); // [{ kind: "all", applies: 4, mpx: 2.1 }]
 * ```
 */
function totalFilterRows(
  total: PerfSpikeRecord["filters"]
): { readonly kind: string; readonly applies: number; readonly mpx: number }[] {
  if (total === null || total.applies === 0) return [];
  return [{ kind: "all", ...total }];
}

/**
 * The filters of the frame: per kind from the engine's line, else the record's total; undefined
 * when it applied none.
 *
 * @param record - The record.
 * @returns The rows.
 */
function filterRows(record: PerfSpikeRecord): ValueRow[] | undefined {
  const kinds = record.detail?.filters;
  const rows = kinds ?? totalFilterRows(record.filters);
  if (rows.length === 0) return undefined;
  return rows.map(row => ({
    label: row.kind,
    value: `${whole(row.applies)}×, ${row.mpx.toFixed(1)} Mpx`,
    tone: "plain"
  }));
}

/**
 * "This frame": draws, uploads (amber from 1 MB), shader compiles, long frame, flow path, rate.
 *
 * @param record - The record.
 * @returns The rows.
 */
function frameRows(record: PerfSpikeRecord): ValueRow[] {
  const long = record.detail?.longFrames[0];
  const longText = record.detail === null ? DASH : "none";
  return [
    { label: "draws", value: record.draws === null ? DASH : whole(record.draws), tone: "value" },
    {
      label: "uploads",
      value: record.uploads === null ? DASH : `${record.uploads.mb.toFixed(1)} MB`,
      tone: (record.uploads?.mb ?? 0) >= UPLOAD_CAUTION_MB ? "warn" : "value"
    },
    {
      label: "shader compiles",
      value: record.compiles === null ? DASH : whole(record.compiles),
      tone: "value"
    },
    {
      label: "long frame",
      value: long === undefined ? longText : `${whole(long.durationMs)} ms`,
      tone: "value"
    },
    { label: "flow path", value: record.path, tone: "plain" },
    { label: "rate", value: `${whole(record.fps)} fps`, tone: "value" }
  ];
}

/**
 * The rate switch of the frame: "rate 120 → 60 (missed, auto)".
 *
 * @param record - The record.
 * @returns The text; undefined without a switch.
 */
function rateSwitchText(record: PerfSpikeRecord): string | undefined {
  const change = record.rateSwitch;
  if (change === null) return undefined;
  const why = [change.reason, change.mode].filter(part => part !== null);
  const reason = why.length === 0 ? "" : ` (${why.join(", ")})`;
  return `rate ${whole(change.from)} → ${whole(change.to)}${reason}`;
}

/**
 * "What changed": the engine's changes with their subjects (else the record's change kinds), the
 * rate switch, then the game's frame events in order — an overlay as "label what", a pool trim as
 * "pool trim −41.5 MB (rest)", a warm-up as "warm-up 12 draws".
 *
 * @param record - The record.
 * @returns The text joined by " · "; undefined when nothing changed.
 */
function changedText(record: PerfSpikeRecord): string | undefined {
  const changes = record.detail?.frame.changed.map(change =>
    change.what === null ? change.kind : `${change.kind} ${change.what}`
  ) ?? [...record.changed];
  const rate = rateSwitchText(record);
  const events = record.events.map(event => {
    if (event.kind === "overlay") return `${event.label} ${event.what}`;
    if (event.kind === "pool-trim")
      return `pool trim −${event.freedMb.toFixed(1)} MB (${event.reason})`;
    return `warm-up ${whole(event.draws)} draws`;
  });
  const parts = [...changes, ...(rate === undefined ? [] : [rate]), ...events];
  return parts.length === 0 ? undefined : parts.join(CHANGE_SEPARATOR);
}

/**
 * The rows of the record side panel.
 *
 * @param record - The record (a copy that stays when the frame leaves the window).
 * @param recorder - The recorder status, for the log clock; undefined without the source.
 * @returns The view.
 */
export function recordView(
  record: PerfSpikeRecord,
  recorder: RecorderStatus | undefined
): RecordView {
  const style = CAUSE_STYLE[record.cause];
  const gpu = gpuColumn(record);
  return {
    title: `Frame ${record.frame}`,
    sub: subLine(record, recorder),
    causes: legendsOf(record),
    word: style.word,
    ms: record.ms.toFixed(1),
    over: `+${record.overMs.toFixed(1)} ms over`,
    budget: record.budgetMs.toFixed(1),
    severity: record.ms > 2 * record.budgetMs ? "red" : "amber",
    why: record.why,
    hue: style.hue,
    phases: phaseRows(record),
    gpuTitle: gpu.title,
    passes: gpu.rows,
    systems: systemRows(record),
    filters: filterRows(record),
    thisFrame: frameRows(record),
    changed: changedText(record),
    note: record.detail === null ? DETAIL_NOTE : undefined
  };
}
