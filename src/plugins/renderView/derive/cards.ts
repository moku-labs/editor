/**
 * @file renderView derive — the sparkline cards' numbers and words (spec 09 § M9 Cards): FPS, Frame
 * time, Draw calls, Textures and GPU passes over the view's frames; a waiting source shows dashes,
 * never zeros; GPU ms carries its clock when a wired phone reports one; a tile GPU shows shares; the
 * "In selection" line only with a selection. (Memory and Device load: `memory.ts`, `load.ts`.) Pure.
 */
import { spikeGroups } from "../series/groups";
import { firstVisibleRow, rowFrom, rowOfFrame } from "../series/rows";
import { percentileOf } from "../series/stats";
import type { SeriesColumn } from "../series/types";
import type {
  DeviceTelemetry,
  PerfHistory,
  PerfPassesSummary,
  PerfSecond
} from "../source/contract";
import { REST, rangeRows, rangeSummary, rateFps } from "../source/contract";
import type { AssetsUsage, FrameRange, MissionState } from "../types";
import { frameFpsAt } from "./header";
import { rateNow } from "./rate";
import { framePassGpu } from "./tooltip";
import type { Line, Tag } from "./words";
import { DASH, oneDecimal, strong } from "./words";

/** A share as a percent. */
const PERCENT = 100;

/**
 * The tag colour of a card's headline.
 *
 * @example
 * ```ts
 * const tag: CardTag = "warn"; // FPS below the display rate
 * ```
 */
export type CardTag = "ok" | "warn" | "muted";

/**
 * What a card shows: its value and unit (and a second pair), a tag, the footer lines and the "In
 * selection" line.
 *
 * @example
 * ```ts
 * const card: CardView = { value: "60", unit: "fps now", tag: { text: "target 120", tone: "warn" }, lines: [], inSelection: undefined };
 * ```
 */
export type CardView = {
  readonly value: string;
  readonly unit: string;
  readonly extra?: { readonly value: string; readonly unit: string };
  readonly tag?: Tag;
  readonly tags?: readonly Tag[];
  readonly lines: readonly Line[];
  readonly inSelection: string | undefined;
};

/**
 * What every card reads: the history and the view, the source's second, waiting or not, the
 * selection.
 *
 * @example
 * ```ts
 * const input: CardsInput = { history, startMs: 74_000, endMs: 80_000, second, waiting: false, selection: undefined };
 * ```
 */
export type CardsInput = {
  readonly history: PerfHistory;
  readonly startMs: number;
  readonly endMs: number;
  readonly second: PerfSecond | undefined;
  /** The source is up but sent no frame yet: every value "—", never 0. */
  readonly waiting: boolean;
  readonly selection: FrameRange | undefined;
};

/** The rows of the view (reused per call). */
type ViewRows = { readonly first: number; readonly end: number };

/**
 * The rows of the view.
 *
 * @param input - The cards' input.
 * @returns First and the row after the last.
 */
function viewRows(input: CardsInput): ViewRows {
  return {
    first: firstVisibleRow(input.history, input.startMs),
    end: rowFrom(input.history, input.endMs)
  };
}

/**
 * The FPS card's tag: warn below the display rate, ok at it, muted while waiting.
 *
 * @param fps - The rate now; null while waiting.
 * @param displayHz - The display's rate; null when not known.
 * @returns The tag.
 * @example
 * ```ts
 * fpsTag(60, 120); // "warn"
 * ```
 */
export function fpsTag(fps: number | null, displayHz: number | null): CardTag {
  if (fps === null) return "muted";
  return displayHz !== null && fps < displayHz ? "warn" : "ok";
}

/**
 * The rate events in a time range.
 *
 * @param history - The history.
 * @param from - The range's start.
 * @param to - Its end.
 * @returns The rate events, oldest first.
 */
function ratesIn(
  history: PerfHistory,
  from: number,
  to: number
): { readonly from: number; readonly to: number }[] {
  const rates: { from: number; to: number }[] = [];
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind === "rate" && event.t >= from && event.t <= to) rates.push(event);
  }
  return rates;
}

/**
 * The time range of a selection (the Memory and Device load cards' "In selection" read their series
 * over it).
 *
 * @param history - The history.
 * @param selection - The selection.
 * @returns Its start and end; undefined when none of it is held.
 * @example
 * ```ts
 * selectionTimes(history, { from: 4810, to: 4860 }); // { from: 77_310, to: 78_160 }
 * ```
 */
export function selectionTimes(
  history: PerfHistory,
  selection: FrameRange
): { readonly from: number; readonly to: number } | undefined {
  const { first, last } = rangeRows(history, selection.from, selection.to);
  if (first < 0) return undefined;
  return { from: history.t[first] ?? 0, to: (history.t[last] ?? 0) + (history.ms[last] ?? 0) };
}

/**
 * The FPS card's "In selection": missed frames and the rate changes inside it.
 *
 * @param input - The cards' input.
 * @returns The line; undefined without a selection.
 */
function fpsInSelection(input: CardsInput): string | undefined {
  const { history, selection } = input;
  if (selection === undefined) return undefined;
  const { first, last } = rangeRows(history, selection.from, selection.to);
  const times = selectionTimes(history, selection);
  if (first < 0 || times === undefined) return undefined;
  let missed = 0;
  for (let row = first; row <= last; row += 1) {
    if (history.rest[row] === REST.awake && (history.ms[row] ?? 0) > (history.budgetMs[row] ?? 0))
      missed += 1;
  }
  const changes = ratesIn(history, times.from, times.to).map(
    rate => `, rate ${rate.from} → ${rate.to}`
  );
  return `${missed} missed frame${missed === 1 ? "" : "s"}${changes.join("")}`;
}

/**
 * The FPS card: the rate now ("fps now"), its tag (pinned, resting, or the display's target), and
 * the rate changes in view.
 *
 * @param input - The cards' input.
 * @returns The card.
 * @example
 * ```ts
 * fpsCard(input).tag; // { text: "target 120", tone: "warn" } at 60 fps on a 120 Hz display
 * ```
 */
export function fpsCard(input: CardsInput): CardView {
  const { second } = input;
  const fps = second?.rate.fps;
  if (input.waiting || second === undefined || fps === null || fps === undefined) {
    return { value: DASH, unit: "fps now", lines: [], inSelection: undefined };
  }
  const now = rateNow(second);
  const hz = second.rate.displayHz;
  let tag: Tag = { text: `target ${hz ?? fps}`, tone: fpsTag(fps, hz) };
  if (now?.pinned === true) tag = { text: "pinned, adaptive off", tone: "acc" };
  else if (second.activity?.idle === true) tag = { text: "resting", tone: "muted" };
  const changes = ratesIn(input.history, input.startMs, input.endMs).length;
  const lines: Line[] =
    changes === 0
      ? []
      : [
          [
            `${changes} adaptive rate change${changes === 1 ? "" : "s"} in view, marked on the graph`
          ]
        ];
  return { value: String(fps), unit: "fps now", tag, lines, inSelection: fpsInSelection(input) };
}

/**
 * The newest awake row of the view.
 *
 * @param history - The history.
 * @param rows - The view's rows.
 * @returns The row; −1 without one.
 */
function newestAwake(history: PerfHistory, rows: ViewRows): number {
  for (let row = rows.end - 1; row >= rows.first; row -= 1) {
    const rest = history.rest[row];
    if (rest === REST.awake || rest === REST.woke) return row;
  }
  return -1;
}

/**
 * The rest budget of the view's resting rows, when it has some.
 *
 * @param history - The history.
 * @param rows - The view's rows.
 * @returns ms; undefined when the view does not rest.
 */
function restBudget(history: PerfHistory, rows: ViewRows): number | undefined {
  for (let row = rows.end - 1; row >= rows.first; row -= 1) {
    if (history.rest[row] === REST.idle) return history.budgetMs[row];
  }
  return undefined;
}

/**
 * The worst frame of a selection: "worst {ms} ms, f{n}".
 *
 * @param input - The cards' input.
 * @returns The line; undefined without a selection.
 */
function worstInSelection(input: CardsInput): string | undefined {
  const { history, selection } = input;
  if (selection === undefined) return undefined;
  const { first, last } = rangeRows(history, selection.from, selection.to);
  if (first < 0) return undefined;
  let worst = first;
  for (let row = first; row <= last; row += 1) {
    if ((history.ms[row] ?? 0) > (history.ms[worst] ?? 0)) worst = row;
  }
  return `worst ${oneDecimal(history.ms[worst] ?? 0)} ms, f${history.frame[worst] ?? 0}`;
}

/**
 * The Frame time card: p50 and p90 of the awake frames in view, the budget (and the rest budget when
 * the view rests), a note when the GPU is not measured.
 *
 * @param input - The cards' input.
 * @returns The card.
 * @example
 * ```ts
 * frameTimeCard(input).lines[0]; // ["Budget 8.3 ms at 120 fps"]
 * ```
 */
export function frameTimeCard(input: CardsInput): CardView {
  const { history } = input;
  const rows = viewRows(input);
  const awake = { ...rows, awake: true };
  const p50 = input.waiting ? undefined : percentileOf(history, history.ms, awake, 0.5);
  const p90 = input.waiting ? undefined : percentileOf(history, history.ms, awake, 0.9);
  if (p50 === null || p90 === null || p50 === undefined || p90 === undefined) {
    return {
      value: DASH,
      unit: "ms p50",
      extra: { value: DASH, unit: "ms p90" },
      lines: [],
      inSelection: undefined
    };
  }
  const newest = newestAwake(history, rows);
  const budget = history.budgetMs[newest] ?? 0;
  const rest = restBudget(history, rows);
  const budgetText = `Budget ${oneDecimal(budget)} ms at ${rateFps(history.rateMs[newest] ?? 0)} fps`;
  const lines: Line[] = [
    [rest === undefined ? budgetText : `${budgetText}, ${oneDecimal(rest)} ms while resting`]
  ];
  if (!history.gpuTimer) lines.push(["GPU time is not measured on this device"]);
  return {
    value: oneDecimal(p50),
    unit: "ms p50",
    extra: { value: oneDecimal(p90), unit: "ms p90" },
    lines,
    inSelection: worstInSelection(input)
  };
}

/**
 * The most draw calls of a selection.
 *
 * @param input - The cards' input.
 * @returns "max {n}"; undefined without a selection or a count.
 */
function drawsInSelection(input: CardsInput): string | undefined {
  const { history, selection } = input;
  if (selection === undefined) return undefined;
  const { first, last } = rangeRows(history, selection.from, selection.to);
  let max = Number.NEGATIVE_INFINITY;
  for (let row = Math.max(first, 0); first >= 0 && row <= last; row += 1) {
    max = Math.max(max, history.draws[row] ?? Number.NaN);
  }
  return Number.isFinite(max) ? `max ${Math.round(max)}` : undefined;
}

/**
 * The Draw calls card: p90 per frame and the range in view; all frames without a count (WebGL)
 * read "—" with "Draw calls are counted on WebGPU only".
 *
 * @param input - The cards' input.
 * @returns The card.
 * @example
 * ```ts
 * drawCallsCard(input).value; // "212"
 * ```
 */
export function drawCallsCard(input: CardsInput): CardView {
  const { history } = input;
  const rows = { ...viewRows(input), awake: false };
  if (input.waiting) {
    return { value: DASH, unit: "p90 per frame", lines: [], inSelection: undefined };
  }
  const p90 = percentileOf(history, history.draws, rows, 0.9);
  if (p90 === null) {
    return {
      value: DASH,
      unit: "p90 per frame",
      lines: [["Draw calls are counted on WebGPU only"]],
      inSelection: undefined
    };
  }
  const min = percentileOf(history, history.draws, rows, 0) ?? p90;
  const max = percentileOf(history, history.draws, rows, 1) ?? p90;
  return {
    value: String(Math.round(p90)),
    unit: "p90 per frame",
    lines: [[`${Math.round(min)}–${Math.round(max)} in this window`]],
    inSelection: drawsInSelection(input)
  };
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

/**
 * The texture change over the selection: "{a} → {b} MB", "unchanged", or undefined without a
 * selection.
 *
 * @param input - The cards' input with the textures series.
 * @returns The words.
 */
function textureChangeInSelection(
  input: CardsInput & { readonly textures: SeriesColumn }
): string | undefined {
  const times =
    input.selection === undefined ? undefined : selectionTimes(input.history, input.selection);
  if (times === undefined) return undefined;
  const before = valueAt(input.textures, times.from);
  const after = valueAt(input.textures, times.to);
  const unchanged = before === after || Number.isNaN(before);
  return unchanged ? "unchanged" : `${oneDecimal(before)} → ${oneDecimal(after)} MB`;
}

/**
 * The Textures card: MB of the budget, the share of it and the texture count, and the change inside
 * the selection.
 *
 * @param input - The cards' input with game.assets, game.render's texture count and the 1 Hz MB series.
 * @param input.assets - game.assets.
 * @param input.count - game.render.textures.
 * @param input.textures - The textures MB series.
 * @returns The card and the bar's share (0 to 1; null when there is no bar).
 * @example
 * ```ts
 * texturesCard({ ...input, assets, count: 40, textures: series.textures }).lines[0]; // [{ strong: "40" }, " textures, 68 % of budget"]
 * ```
 */
export function texturesCard(
  input: CardsInput & {
    readonly assets: AssetsUsage | undefined;
    readonly count: number | undefined;
    readonly textures: SeriesColumn;
  }
): CardView & { readonly share: number | null } {
  // Nothing to show while waiting or without assets.
  const { assets } = input;
  if (input.waiting || assets === undefined) {
    // eslint-disable-next-line unicorn/no-null -- null: no bar
    return { value: DASH, unit: "MB", lines: [], inSelection: undefined, share: null };
  }

  // The budget share and the texture count line.
  const share = assets.budgetMb > 0 ? assets.textureMb / assets.budgetMb : 0;
  const pct = `${Math.round(share * PERCENT)} % of budget`;
  const lines: Line[] = [
    input.count === undefined ? [pct] : [strong(String(input.count)), ` textures, ${pct}`]
  ];

  return {
    value: oneDecimal(assets.textureMb),
    unit: `MB of ${oneDecimal(assets.budgetMb)} MB`,
    lines,
    inSelection: textureChangeInSelection(input),
    share: Math.min(1, share)
  };
}

/**
 * The clock tag of a wired phone: "at {mhz} MHz, {busy} % busy".
 *
 * @param telemetry - The active device's telemetry.
 * @returns The tag; undefined without a GPU reading.
 */
function clockTag(telemetry: DeviceTelemetry | undefined): Tag | undefined {
  const gpu = telemetry?.gpu;
  if (gpu?.available !== true || gpu.value.mhz === null) return undefined;
  const busy = gpu.value.busyPct === null ? "" : `, ${Math.round(gpu.value.busyPct)} % busy`;
  return { text: `at ${Math.round(gpu.value.mhz)} MHz${busy}`, tone: "plain" };
}

/**
 * The chain lines of the GPU passes card: "{label} **{max} ms** in the GPU spikes" for a chain whose
 * max is above twice its p50, "{label} **{p50}**" otherwise; on a tile GPU "{label} **≈ {share} %**".
 *
 * @param summary - The second's passes summary.
 * @returns The lines (three at most).
 */
function chainLines(summary: PerfPassesSummary): Line[] {
  return summary.chains.slice(0, 3).flatMap(chain => {
    const label = chain.view ?? chain.kinds.join(" → ");
    if (summary.tiler) {
      return chain.share === null
        ? []
        : [[`${label} `, strong(`≈ ${Math.round(chain.share * PERCENT)} %`)]];
    }
    const gpu = chain.gpuMs;
    if (gpu === null) return [];
    if (gpu.max > 2 * gpu.p50)
      return [[`${label} `, strong(`${oneDecimal(gpu.max)} ms`), " in the GPU spikes"]];
    return [[`${label} `, strong(oneDecimal(gpu.p50))]];
  });
}

/**
 * The heaviest chain of a selection: "{label} {sum} ms over {n} frames".
 *
 * @param input - The cards' input.
 * @returns The line; undefined without a selection or a measured chain.
 */
function chainInSelection(input: CardsInput): string | undefined {
  const { history, selection } = input;
  if (selection === undefined) return undefined;
  const summary = rangeSummary(history, selection.from, selection.to);
  const chain = summary.chains[0];
  if (chain?.gpuMs === null || chain === undefined) return undefined;
  return `${chain.view ?? chain.kinds.join(" → ")} ${oneDecimal(chain.gpuMs)} ms over ${summary.frames} frames`;
}

/**
 * The typical number of passes of a drawn frame in view: the median count over the frames that ran
 * any pass, from the history's pass rows.
 *
 * @param history - The history.
 * @param rows - The rows in view.
 * @returns The count; null when no frame in view ran a pass.
 */
function typicalPasses(history: PerfHistory, rows: ViewRows): number | null {
  // The frames in view.
  const first = history.frame[rows.first] ?? 0;
  const last = history.frame[rows.end - 1] ?? -1;

  // Count the passes of each frame (the pass rows are in frame order).
  const counts: number[] = [];
  let frame = -1;
  for (let pass = 0; pass < history.passCount; pass += 1) {
    const passFrame = history.passFrame[pass] ?? 0;
    if (passFrame < first || passFrame > last) continue;
    if (passFrame === frame) counts[counts.length - 1] = (counts.at(-1) ?? 0) + 1;
    else counts.push(1);
    frame = passFrame;
  }

  // The median count.
  counts.sort((a, b) => a - b);
  // eslint-disable-next-line unicorn/no-null -- null: no pass in view
  return counts[counts.length >> 1] ?? null;
}

/**
 * The passes a frame the card shows: the newest second's heaviest frame's, or, when that second drew
 * no frame (an idle game), the typical drawn frame's in view; never 0 beside a GPU time.
 *
 * @param history - The history.
 * @param rows - The rows in view.
 * @param passes - The newest passes summary.
 * @returns The words: a count, or "—".
 */
function passesValue(history: PerfHistory, rows: ViewRows, passes: PerfPassesSummary): string {
  const heaviest = passes.heaviest?.passes.length ?? 0;
  if (heaviest > 0) return String(heaviest);
  const typical = typicalPasses(history, rows);
  return typical === null ? DASH : String(typical);
}

/**
 * The GPU passes card: passes a frame, the view's typical frame GPU (p50) with the clock beside it
 * on a wired phone (DVFS), the issues, the top chains; a tile GPU shows shares, never ms per pass.
 *
 * @param input - The cards' input with the passes summary, the telemetry and the active issues.
 * @param input.passes - The newest passes summary.
 * @param input.telemetry - The active device's telemetry.
 * @param input.issues - Active problems.
 * @returns The card.
 * @example
 * ```ts
 * gpuPassesCard({ ...input, passes, telemetry, issues: 1 }).tags; // [{ text: "at 585 MHz, 64 % busy", tone: "plain" }, { text: "1 issue", tone: "warn" }]
 * ```
 */
export function gpuPassesCard(
  input: CardsInput & {
    readonly passes: PerfPassesSummary | undefined;
    readonly telemetry: DeviceTelemetry | undefined;
    readonly issues: number;
  }
): CardView {
  const { history, passes } = input;
  if (input.waiting || passes === undefined) {
    return { value: DASH, unit: "passes a frame", lines: [], inSelection: undefined };
  }
  const gpu = percentileOf(history, history.gpuMs, { ...viewRows(input), awake: true }, 0.5);
  const tags: Tag[] = [];
  const clock = clockTag(input.telemetry);
  if (clock !== undefined) tags.push(clock);
  if (input.issues > 0)
    tags.push({ text: `${input.issues} issue${input.issues === 1 ? "" : "s"}`, tone: "warn" });
  return {
    value: passesValue(history, viewRows(input), passes),
    unit: "passes a frame",
    extra: { value: gpu === null ? DASH : oneDecimal(gpu), unit: "ms typical" },
    tags,
    lines: [...chainLines(passes), ["Shader compiles marked on the shared axis"]],
    inSelection: chainInSelection(input)
  };
}

/**
 * The spikes of a view as the frames header counts them (groups), for a card's note.
 *
 * @param history - The history.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 * @returns The spike groups in view.
 * @example
 * ```ts
 * spikesInView(history, 74_000, 80_000); // 3
 * ```
 */
export function spikesInView(history: PerfHistory, startMs: number, endMs: number): number {
  return spikeGroups(history, firstVisibleRow(history, startMs), rowFrom(history, endMs) - 1)
    .length;
}

/**
 * The frame of a time in the history (the cursor readout of a card: "f4851 16.2 ms").
 *
 * @param history - The history.
 * @param frame - A frame.
 * @returns The readout; undefined when the frame is not held.
 * @example
 * ```ts
 * cursorReadout(history, 4851); // "f4851 16.2 ms"
 * ```
 */
export function cursorReadout(history: PerfHistory, frame: number): string | undefined {
  const row = rowOfFrame(history, frame);
  return row < 0 ? undefined : `f${frame} ${oneDecimal(history.ms[row] ?? 0)} ms`;
}

/** A side-series sample older than this before the hovered frame, ms, is not its value. */
const READOUT_HOLD_MS = 2000;

/**
 * The newest sample of a series at or before a time, when it is not older than READOUT_HOLD_MS.
 *
 * @param column - The series.
 * @param t - Source-clock ms.
 * @returns The value; NaN without one.
 */
function heldAt(column: SeriesColumn, t: number): number {
  let value = Number.NaN;
  for (let index = 0; index < column.count && (column.t[index] ?? 0) <= t; index += 1) {
    value =
      (column.t[index] ?? 0) >= t - READOUT_HOLD_MS ? (column.v[index] ?? Number.NaN) : Number.NaN;
  }
  return value;
}

/**
 * What a card charts, for its cursor chip.
 *
 * @example
 * ```ts
 * const kind: ReadoutKind = "memory";
 * ```
 */
export type ReadoutKind =
  | "fps"
  | "frame"
  | "draws"
  | "textures"
  | "gpu"
  | "memory"
  | "cpu"
  | "gpuLoad";

/**
 * The value of a series-backed card at a time, in words.
 *
 * @param kind - The card.
 * @param mission - Mission control's state.
 * @param t - The frame's time.
 * @returns The words after "f{n} "; undefined without a value.
 */
function seriesReadout(kind: ReadoutKind, mission: MissionState, t: number): string | undefined {
  const { series } = mission;
  if (kind === "textures" || kind === "memory") {
    const mb = heldAt(kind === "memory" ? series.heap : series.textures, t);
    return Number.isNaN(mb) ? undefined : `${oneDecimal(mb)} MB`;
  }
  const { load } = series;
  if (kind === "cpu") {
    const app = heldAt(load.cpuApp, t);
    if (Number.isNaN(app)) return undefined;
    const renderer = heldAt(load.cpuRenderer, t);
    const flinger = heldAt(load.cpuFlinger, t);
    const pct = (value: number): string => (Number.isNaN(value) ? DASH : `${Math.round(value)} %`);
    return `app ${pct(app)}, renderer ${pct(renderer)}, sf ${pct(flinger)}`;
  }
  const busy = heldAt(load.gpuBusy, t);
  const mhz = heldAt(load.gpuMhz, t);
  if (Number.isNaN(busy) && Number.isNaN(mhz)) return undefined;
  const clock = Number.isNaN(mhz) ? "" : ` at ${Math.round(mhz)} MHz`;
  return `${Number.isNaN(busy) ? DASH : Math.round(busy)} % busy${clock}`;
}

/**
 * The value of a frame-backed card at a row, in words.
 *
 * @param kind - The card.
 * @param history - The history.
 * @param row - The frame's row.
 * @param frame - The frame.
 * @returns The words after "f{n} "; undefined without a value.
 */
function frameReadout(
  kind: ReadoutKind,
  history: PerfHistory,
  row: number,
  frame: number
): string | undefined {
  if (kind === "frame") return `${oneDecimal(history.ms[row] ?? 0)} ms`;
  if (kind === "fps") return `${frameFpsAt(history, row)} fps`;
  if (kind === "draws") {
    const draws = history.draws[row] ?? Number.NaN;
    return Number.isNaN(draws) ? undefined : String(Math.round(draws));
  }
  const gpu = framePassGpu(history, frame);
  return Number.isNaN(gpu) ? undefined : `${oneDecimal(gpu)} ms`;
}

/**
 * Whether a card's readout comes from a 1 Hz side series (textures, memory, device load), not from
 * the frame rows.
 *
 * @param kind - The card.
 * @returns True for a series-backed card.
 */
function isSeriesBacked(kind: ReadoutKind): boolean {
  return kind === "textures" || kind === "memory" || kind === "cpu" || kind === "gpuLoad";
}

/**
 * A card's cursor chip at the hovered frame: "f4851 16.2 ms" (Frame time), "f4851 60 fps", "f4851
 * 212" (Draw calls), "f4851 41.3 MB" (Memory), …; each card reads its own measure, from the history
 * or from its side series at the frame's time.
 *
 * @param kind - The card.
 * @param mission - Mission control's state.
 * @param frame - The hovered frame.
 * @returns The chip's words; undefined when the card has no value there (never 0).
 * @example
 * ```ts
 * readoutOf("memory", mission, 4851); // "f4851 41.3 MB"
 * ```
 */
export function readoutOf(
  kind: ReadoutKind,
  mission: MissionState,
  frame: number
): string | undefined {
  const { history } = mission;
  const row = rowOfFrame(history, frame);
  if (row < 0) return undefined;
  const words = isSeriesBacked(kind)
    ? seriesReadout(kind, mission, history.t[row] ?? 0)
    : frameReadout(kind, history, row, frame);
  return words === undefined ? undefined : `f${frame} ${words}`;
}
