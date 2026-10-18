/**
 * @file renderView derive — the inspector (spec 09 § M10): the summary of the view (top systems and
 * passes, spikes newest first, GCs, rate changes) or the range view of the selection from perf's
 * `rangeSummary` after the detail read (systems — every one when the engine's detail carried them,
 * else the per-frame top 5, or prorated per second — nodes, files, passes, filters, shader compiles,
 * rate changes, spikes, GCs, object counters), with its headline and notes. Pure; allocates once per
 * derivation (at most once a second, or per selection).
 */
import { spikeGroups } from "../series/groups";
import { firstVisibleRow, rowAtTime, rowFrom, rowOfFrame } from "../series/rows";
import { engineGcNear } from "../series/stats";
import type { ObjectSeries, SeriesColumn, SpikeGroup } from "../series/types";
import type {
  PerfCause,
  PerfDetailWire,
  PerfHistory,
  PerfRangeSummary,
  PerfSecond,
  PerfTimelineEvent
} from "../source/contract";
import { rangeRows, rangeSummary } from "../source/contract";
import type {
  CompileRow,
  FileRow,
  FilterRow,
  GcRow,
  InspectorView,
  MissionDetail,
  MissionState,
  NodeRow,
  ObjectRow,
  PassRow,
  RateRow,
  SpikeRow,
  SystemRow
} from "../types";
import type { FrameRange } from "../view/types";
import { rateNow } from "./rate";
import { oneDecimal, secondsText } from "./words";

/** Rows of each summary list. */
const SUMMARY_SYSTEMS = 3;
const SUMMARY_PASSES = 3;
const SUMMARY_SPIKES = 5;
const SUMMARY_GCS = 4;

/** The words of each spike cause (spec 09 § M8 Legend). */
export const CAUSE_LABELS: Readonly<Record<PerfCause, string>> = {
  js: "JS over budget",
  gpu: "GPU sustained",
  upload: "Upload",
  compile: "Shader compile",
  longFrame: "Long frame",
  "gc?": "GC",
  gap: "Gap"
};

/** The words of each node `how` (spec 09 § M10 Nodes). */
const HOW_WORDS: Readonly<
  Record<NonNullable<PerfDetailWire["nodes"]>[number]["how"], NodeRow["how"]>
> = {
  redraw: "redrawn",
  mark: "updated",
  moved: "moved",
  loose: "loosened",
  invalidate: "invalidated"
};

/** The words of each rate-change reason. */
const RATE_WHY: Readonly<Record<string, string>> = {
  missed: "missed frames",
  headroom: "back on time",
  thermal: "thermal",
  display: "display"
};

/**
 * The words of a rate change's reason.
 *
 * @param from - fps before.
 * @param to - fps after.
 * @param reason - The engine's reason.
 * @returns "missed frames", "back on time", "thermal", "display".
 */
function rateWhy(from: number, to: number, reason: string): string {
  return to > from ? "back on time" : (RATE_WHY[reason] ?? reason);
}

/**
 * A span in words: "6 s", "30 s", "2 min".
 *
 * @param span - ms.
 * @returns The words.
 * @example
 * ```ts
 * spanWords(120_000); // "2 min"
 * ```
 */
export function spanWords(span: number): string {
  return span >= 60_000 ? `${Math.round(span / 60_000)} min` : `${Math.round(span / 1000)} s`;
}

/**
 * The systems of a range summary as rows.
 *
 * @param summary - The range summary.
 * @returns The rows.
 */
function systemRows(summary: PerfRangeSummary): SystemRow[] {
  return summary.systems.map(system => ({ ...system }));
}

/**
 * The passes of a range summary as rows ("{view} · {kind}").
 *
 * @param summary - The range summary.
 * @returns The rows.
 */
function passRows(summary: PerfRangeSummary): PassRow[] {
  return summary.passes.map(pass => ({
    label: pass.view === null ? pass.kind : `${pass.view} · ${pass.kind}`,
    count: pass.count,
    gpuMs: pass.gpuMs,
    share: pass.share
  }));
}

/**
 * A spike group as a row: its frames, cause, label, worst ms and how far over its budget.
 *
 * @param history - The history.
 * @param group - The group.
 * @returns The row.
 */
function spikeRow(history: PerfHistory, group: SpikeGroup): SpikeRow {
  let worst = group.firstRow;
  for (let row = group.firstRow; row <= group.lastRow; row += 1) {
    if ((history.ms[row] ?? 0) > (history.ms[worst] ?? 0)) worst = row;
  }
  const over = (history.ms[worst] ?? 0) - (history.budgetMs[worst] ?? 0);
  const count = group.to - group.from + 1;
  const label = count > 1 ? `${CAUSE_LABELS[group.cause]} ×${count}` : CAUSE_LABELS[group.cause];
  return {
    from: group.from,
    to: group.to,
    cause: group.cause,
    label,
    maxMs: group.maxMs,
    why: `${oneDecimal(Math.max(0, over))} ms over budget`
  };
}

/**
 * The GC pause of a frame a GC names: its ms less its JS and GPU.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns ms; null when the frame is not held.
 */
function pauseOf(history: PerfHistory, frame: number | null): number | null {
  const row = frame === null ? -1 : rowOfFrame(history, frame);
  // eslint-disable-next-line unicorn/no-null -- null: no pause known
  if (row < 0) return null;
  const gpu = history.gpuMs[row] ?? Number.NaN;
  const pause = (history.ms[row] ?? 0) - (history.jsMs[row] ?? 0) - (Number.isNaN(gpu) ? 0 : gpu);
  // eslint-disable-next-line unicorn/no-null -- null: no pause in the frame
  return pause > 0 ? Math.round(pause * 10) / 10 : null;
}

/**
 * The frame of an event, or the row its time falls in.
 *
 * @param history - The history.
 * @param frame - The event's frame.
 * @param t - Its time.
 * @returns The frame; 0 when no row holds it.
 */
function frameOfEvent(history: PerfHistory, frame: number | null, t: number): number {
  if (frame !== null) return frame;
  return history.frame[Math.max(0, rowAtTime(history, t))] ?? 0;
}

/** A GC event of the timeline. */
type GcEvent = Extract<PerfTimelineEvent, { kind: "gc" }>;

/** A rate event of the timeline. */
type RateEvent = Extract<PerfTimelineEvent, { kind: "rate" }>;

/** A shader event of the timeline. */
type ShaderEvent = Extract<PerfTimelineEvent, { kind: "shader" }>;

/** The GC, rate and shader events of a time range, oldest first. */
type RangeEvents = {
  readonly gcs: GcEvent[];
  readonly rates: RateEvent[];
  readonly shaders: ShaderEvent[];
};

/**
 * The GC, rate and shader events whose time lies in a range, oldest first.
 *
 * @param history - The history.
 * @param from - The range's start.
 * @param to - Its end.
 * @returns The events by kind.
 */
function eventsIn(history: PerfHistory, from: number, to: number): RangeEvents {
  const found: RangeEvents = { gcs: [], rates: [], shaders: [] };
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event === undefined || event.t < from || event.t > to) continue;
    if (event.kind === "gc") found.gcs.push(event);
    if (event.kind === "rate") found.rates.push(event);
    if (event.kind === "shader") found.shaders.push(event);
  }
  return found;
}

/**
 * The GCs of the side series in a time range that no engine event names (a wired phone's, seen
 * over CDP or inferred from a heap drop), as GC events between frames.
 *
 * @param mission - Mission control's state.
 * @param from - The range's start.
 * @param to - Its end.
 * @returns The GCs, oldest first.
 */
function seriesGcsIn(
  mission: MissionState,
  from: number,
  to: number
): { readonly frame: null; readonly t: number; readonly freedMb: number }[] {
  const { gcs } = mission.series;
  const found: { readonly frame: null; readonly t: number; readonly freedMb: number }[] = [];
  for (let index = 0; index < gcs.count; index += 1) {
    const t = gcs.t[index] ?? 0;
    if (t < from || t > to || engineGcNear(mission.history, t)) continue;
    // eslint-disable-next-line unicorn/no-null -- null: a GC between frames
    found.push({ frame: null, t, freedMb: gcs.v[index] ?? 0 });
  }
  return found;
}

/**
 * The GC rows of GC events.
 *
 * @param history - The history.
 * @param gcs - The GC events.
 * @returns The rows.
 */
function gcRows(
  history: PerfHistory,
  gcs: readonly { readonly frame: number | null; readonly t: number; readonly freedMb: number }[]
): GcRow[] {
  return gcs.map(gc => ({
    frame: frameOfEvent(history, gc.frame, gc.t),
    freedMb: gc.freedMb,
    pauseMs: pauseOf(history, gc.frame)
  }));
}

/**
 * The rate rows of rate changes.
 *
 * @param rates - The rate changes.
 * @returns The rows.
 */
function rateRows(
  rates: readonly {
    readonly frame: number | null;
    readonly from: number;
    readonly to: number;
    readonly reason: string;
  }[]
): RateRow[] {
  return rates.map(rate => ({
    frame: rate.frame,
    from: rate.from,
    to: rate.to,
    why: rateWhy(rate.from, rate.to, rate.reason)
  }));
}

/**
 * The summary of the view: "Last {span}" live or "{span} in view" paused, the frames, the top 3
 * systems and passes, the spikes newest first (5 at most, the rest counted), the GCs (4 at most) and
 * the rate changes.
 *
 * @param mission - Mission control's state.
 * @param endMs - The view's end.
 * @returns The summary.
 */
function summaryView(mission: MissionState, endMs: number): InspectorView {
  const { history, view } = mission;
  const startMs = endMs - view.span;
  const first = firstVisibleRow(history, startMs);
  const end = rowFrom(history, endMs);
  const frames = Math.max(0, end - first);
  const summary =
    frames > 0
      ? rangeSummary(history, history.frame[first] ?? 0, history.frame[end - 1] ?? 0)
      : undefined;
  const spikes = spikeGroups(history, first, end - 1)
    .toReversed()
    .map(group => spikeRow(history, group));
  const events = eventsIn(history, startMs, endMs);
  const gcs = [...events.gcs, ...seriesGcsIn(mission, startMs, endMs)]
    .toSorted((a, b) => a.t - b.t)
    .toReversed();
  return {
    kind: "summary",
    title: view.live ? `Last ${spanWords(view.span)}` : `${spanWords(view.span)} in view`,
    frames,
    systems: summary === undefined ? [] : systemRows(summary).slice(0, SUMMARY_SYSTEMS),
    passes: summary === undefined ? [] : passRows(summary).slice(0, SUMMARY_PASSES),
    spikes: spikes.slice(0, SUMMARY_SPIKES),
    moreSpikes: Math.max(0, spikes.length - SUMMARY_SPIKES),
    gcs: gcRows(history, gcs).slice(0, SUMMARY_GCS),
    moreGcs: Math.max(0, gcs.length - SUMMARY_GCS),
    rates: rateRows(events.rates)
  };
}

/**
 * How complete a range's systems are.
 *
 * @param detail - The detail read.
 * @param range - The range.
 * @param summary - Its summary.
 * @returns "loading", "full" (the engine's detail), "per-second" or "top5".
 */
function detailOf(
  detail: MissionDetail,
  range: FrameRange,
  summary: PerfRangeSummary
): Extract<InspectorView, { kind: "range" }>["detail"] {
  const same =
    detail.kind !== "idle" && detail.range.from === range.from && detail.range.to === range.to;
  if (same && detail.kind === "loading") return "loading";
  if (same && detail.kind === "shown" && detail.reason === null) return "full";
  return summary.systemsPerSecond ? "per-second" : "top5";
}

/**
 * The nodes of the detail answer for a range, grouped by label and how.
 *
 * @param detail - The detail read.
 * @param range - The range.
 * @returns The rows; empty without nodes.
 */
function nodeRows(detail: MissionDetail, range: FrameRange): NodeRow[] {
  if (detail.kind !== "shown" || detail.range.from !== range.from || detail.range.to !== range.to)
    return [];
  const sums = new Map<string, { label: string; how: NodeRow["how"]; count: number }>();
  for (const node of detail.nodes ?? []) {
    const label = node.label ?? `entity ${node.entity}`;
    const how = HOW_WORDS[node.how];
    const key = `${label}\u0000${how}`;
    const sum = sums.get(key) ?? { label, how, count: 0 };
    sum.count += node.count;
    sums.set(key, sum);
  }
  return [...sums.values()].toSorted((one, other) => other.count - one.count);
}

/**
 * The files of a range's systems the project index resolved (engine systems and unresolved names
 * have none).
 *
 * @param systems - The range's systems.
 * @param files - The `system:<name>` cache.
 * @returns The rows.
 */
function fileRows(systems: readonly SystemRow[], files: MissionState["files"]): FileRow[] {
  return systems.flatMap(system => {
    const file = files.get(system.name);
    return file === undefined || file === null
      ? []
      : [{ path: file.path, line: file.line, system: system.name }];
  });
}

/**
 * The compile rows of a time range (with the view each compiled for).
 *
 * @param history - The history.
 * @param from - The range's start.
 * @param to - Its end.
 * @returns The rows.
 */
function compileRows(history: PerfHistory, from: number, to: number): CompileRow[] {
  return eventsIn(history, from, to).shaders.map(event => ({
    frame: event.frame,
    label: event.label ?? event.what,
    ms: event.ms ?? 0,
    by: event.view
  }));
}

/**
 * The newest value of a series at or before a time.
 *
 * @param column - The series.
 * @param t - Source-clock ms.
 * @returns The value; NaN without one.
 */
function valueAt(column: SeriesColumn, t: number): number {
  let value = Number.NaN;
  for (let index = 0; index < column.count && (column.t[index] ?? 0) <= t; index += 1) {
    value = column.v[index] ?? Number.NaN;
  }
  return value;
}

/** The counters the range view names. */
const OBJECT_NAMES: readonly (readonly [keyof ObjectSeries, string])[] = [
  ["entities", "entities"],
  ["views", "views"],
  ["timers", "timers"],
  ["frameListeners", "listeners"],
  ["inputListeners", "input listeners"],
  ["targets", "render targets"]
];

/**
 * The object counters that changed in a time range.
 *
 * @param objects - The object series.
 * @param from - The range's start.
 * @param to - Its end.
 * @returns The rows.
 */
function objectRows(objects: ObjectSeries, from: number, to: number): ObjectRow[] {
  return OBJECT_NAMES.flatMap(([key, name]) => {
    const before = valueAt(objects[key], from);
    const after = valueAt(objects[key], to);
    if (Number.isNaN(before) || Number.isNaN(after) || before === after) return [];
    return [{ name, from: before, to: after, growing: after > before }];
  });
}

/**
 * The range view of a selection.
 *
 * @param mission - Mission control's state.
 * @param range - The selection.
 * @returns The range view.
 */
function rangeView(mission: MissionState, range: FrameRange): InspectorView {
  const { history, detail } = mission;
  const summary = rangeSummary(history, range.from, range.to);
  const rows = rangeRows(history, range.from, range.to);
  const first = Math.max(rows.first, 0);
  const last = Math.max(rows.last, 0);
  const from = history.t[first] ?? 0;
  const to = (history.t[last] ?? 0) + (history.ms[last] ?? 0);
  const systems = systemRows(summary);
  const lastRow = rowFrom(history, to) - 1;
  return {
    kind: "range",
    range,
    frames: summary.frames,
    durationMs: summary.durationMs,
    worstMs: summary.worstMs ?? 0,
    detail: detailOf(detail, range, summary),
    systems,
    nodes: nodeRows(detail, range),
    files: fileRows(systems, mission.files),
    passes: passRows(summary),
    filters: summary.chains.map(
      (chain): FilterRow => ({
        chain: chain.kinds.join(" → "),
        target: chain.view,
        count: chain.applies,
        gpuMs: chain.gpuMs
      })
    ),
    compiles: compileRows(history, from, to),
    rates: rateRows(summary.rates),
    spikes: spikeGroups(history, rowFrom(history, from), lastRow).map(group =>
      spikeRow(history, group)
    ),
    gcs: gcRows(history, summary.gcs),
    objects: objectRows(mission.series.objects, from, to)
  };
}

/**
 * The inspector's view: the range view of the selection, else the summary of the view.
 *
 * @param mission - Mission control's state (history, selection, detail, files, view).
 * @param endMs - The view's end now, source clock.
 * @returns The summary or range view; undefined without frames.
 * @example
 * ```ts
 * inspectorView(mission, 80_100)?.kind; // "range" while f4810–f4860 is selected
 * ```
 */
export function inspectorView(
  mission: MissionState,
  endMs: number | undefined
): InspectorView | undefined {
  if (mission.history.count === 0) return undefined;
  if (mission.selection !== undefined) return rangeView(mission, mission.selection);
  const end = endMs ?? mission.history.t[mission.history.count - 1] ?? 0;
  return summaryView(mission, end);
}

/**
 * The range view's headline: "{n} frames, {s} s, worst {ms} ms" ("One frame, …"; seconds with two
 * decimals under 1 s).
 *
 * @param view - The range view.
 * @returns The words.
 * @example
 * ```ts
 * rangeHeadline(view); // "51 frames, 0.85 s, worst 21 ms"
 * ```
 */
export function rangeHeadline(view: Extract<InspectorView, { kind: "range" }>): string {
  const frames = view.frames === 1 ? "One frame" : `${view.frames} frames`;
  return `${frames}, ${secondsText(view.durationMs)}, worst ${oneDecimal(view.worstMs)} ms`;
}

/**
 * The range view's title: "f{from}–f{to}", one frame "f{n}".
 *
 * @param range - The selection.
 * @returns The title.
 * @example
 * ```ts
 * rangeTitle({ from: 4810, to: 4860 }); // "f4810–f4860"
 * ```
 */
export function rangeTitle(range: FrameRange): string {
  return range.from === range.to ? `f${range.from}` : `f${range.from}–f${range.to}`;
}

/**
 * The notes under a range's systems: the per-frame top 5, and prorated from per-second totals.
 *
 * @param view - The range view.
 * @returns The notes; empty when the engine's detail carried every system.
 * @example
 * ```ts
 * systemsNotes(view); // ["Top 5 systems per frame.", "Prorated from per-second totals."]
 * ```
 */
export function systemsNotes(view: Extract<InspectorView, { kind: "range" }>): string[] {
  if (view.detail === "full" || view.detail === "loading") return [];
  return view.detail === "per-second"
    ? ["Top 5 systems per frame.", "Prorated from per-second totals."]
    : ["Top 5 systems per frame."];
}

/**
 * The note of the detail read: reading, or why the history's view is shown.
 *
 * @param detail - The detail read.
 * @param name - The source's name.
 * @returns The note; undefined when none applies.
 * @example
 * ```ts
 * detailNote({ kind: "shown", range, reason: "gone", nodes: null }, "Galaxy A26"); // "The phone no longer holds this range in full."
 * ```
 */
export function detailNote(detail: MissionDetail, name: string): string | undefined {
  if (detail.kind === "loading") return `Reading the full range from ${name}…`;
  if (detail.kind === "failed") return "Could not read the full range.";
  if (detail.kind !== "shown") return undefined;
  switch (detail.reason) {
    case "gone": {
      return "The phone no longer holds this range in full.";
    }
    case "no-detail": {
      return "This engine has no range detail.";
    }
    case "control": {
      return "Range detail needs a debug build.";
    }
    case "failed": {
      return "Could not read the full range.";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The words when a view or range has no rate change: pinned "Adaptive is off: pinned at {fps} fps",
 * else "No rate change in view, running {fps} fps".
 *
 * @param second - The source's newest second.
 * @returns The words.
 * @example
 * ```ts
 * noRateText(second); // "Adaptive is off: pinned at 120 fps"
 * ```
 */
export function noRateText(second: PerfSecond | undefined): string {
  const fps = second?.rate.fps;
  if (rateNow(second)?.pinned === true) return `Adaptive is off: pinned at ${fps} fps`;
  return fps === null || fps === undefined
    ? "No rate change in view"
    : `No rate change in view, running ${fps} fps`;
}
