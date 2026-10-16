/**
 * @file renderView derive — the hover tooltip of the frame timeline (spec 09 § M8 Hover tooltip):
 * "f{n}" and its ms, the rows JS, GPU ("off" with the section off, "not measured on this device"
 * without a timer, "{ms} at {mhz} MHz" with a wired phone's clock), Rate, GC pause, Passes and a
 * compile inside the frame, and one line: resting is not a problem, a spike names its cause, a GC its
 * freed MB, else over or within budget. Pure; built when the hovered frame changes, never per move.
 */
import { spikeCodeAt } from "../series/groups";
import { rowOfFrame } from "../series/rows";
import type { PerfHistory, PerfTimelineEvent } from "../source/contract";
import { causeName, REST } from "../source/contract";
import { frameFpsAt, restFpsAt } from "./header";
import { CAUSE_LABELS } from "./inspector";
import { oneDecimal } from "./words";

/**
 * One row of the tooltip.
 *
 * @example
 * ```ts
 * const row: TooltipRow = { label: "GPU", value: "8.1 at 221 MHz" };
 * ```
 */
export type TooltipRow = { readonly label: string; readonly value: string };

/**
 * The tooltip of a frame.
 *
 * @example
 * ```ts
 * const view: TooltipView = { frame: "f4851", ms: "21.6 ms", rows: [{ label: "JS", value: "3.4" }], line: "GPU sustained, 4.9 ms over budget" };
 * ```
 */
export type TooltipView = {
  readonly frame: string;
  readonly ms: string;
  readonly rows: readonly TooltipRow[];
  readonly line: string;
};

/**
 * What the tooltip shows beside the frame's own numbers.
 *
 * @example
 * ```ts
 * const options: TooltipOptions = { gpu: "on", passes: true, gpuMhz: 221, gcShown: true };
 * ```
 */
export type TooltipOptions = {
  /** GPU timing: on, switched off, or not measured on this device. */
  readonly gpu: "on" | "off" | "not-measured";
  /** The Shaders & passes section is on. */
  readonly passes: boolean;
  /** A wired phone's GPU clock now; null without one. */
  readonly gpuMhz: number | null;
  /** GC marks are shown (memory measured and on). */
  readonly gcShown: boolean;
};

/** A GC event of the timeline. */
type GcEvent = Extract<PerfTimelineEvent, { kind: "gc" }>;

/** A shader event of the timeline. */
type ShaderEvent = Extract<PerfTimelineEvent, { kind: "shader" }>;

/**
 * The GC and the compile a frame's events name.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns Its GC and its compile inside the frame, if any.
 */
function eventsOfFrame(
  history: PerfHistory,
  frame: number
): { gc: GcEvent | undefined; compile: ShaderEvent | undefined } {
  let gc: GcEvent | undefined;
  let compile: ShaderEvent | undefined;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.frame !== frame) continue;
    if (event.kind === "gc") gc = event;
    if (event.kind === "shader" && !event.boot) compile = event;
  }
  return { gc, compile };
}

/**
 * The summed GPU of a frame's passes (the tooltip's Passes row, the GPU passes card's chip).
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns ms; NaN when the frame has no measured pass.
 * @example
 * ```ts
 * framePassGpu(history, 4851); // 9.8: main 3.1 + fogLayer 6.2 + hud 0.5
 * ```
 */
export function framePassGpu(history: PerfHistory, frame: number): number {
  let low = 0;
  let high = history.passCount;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((history.passFrame[middle] ?? 0) < frame) low = middle + 1;
    else high = middle;
  }
  let sum = Number.NaN;
  for (let pass = low; pass < history.passCount && history.passFrame[pass] === frame; pass += 1) {
    const gpu = history.passGpuMs[pass] ?? Number.NaN;
    if (!Number.isNaN(gpu)) sum = (Number.isNaN(sum) ? 0 : sum) + gpu;
  }
  return sum;
}

/**
 * The GPU row's value.
 *
 * @param gpuMs - The frame's GPU ms (NaN when not measured).
 * @param options - The section's state and the clock.
 * @returns The words.
 */
function gpuValue(gpuMs: number, options: TooltipOptions): string {
  if (options.gpu === "off") return "off";
  if (options.gpu === "not-measured") return "not measured on this device";
  if (Number.isNaN(gpuMs)) return "—";
  const clock = options.gpuMhz === null ? "" : ` at ${Math.round(options.gpuMhz)} MHz`;
  return `${oneDecimal(gpuMs)}${clock}`;
}

/**
 * The GC pause left in a frame: its ms less its JS and GPU.
 *
 * @param history - The history.
 * @param row - The frame's row.
 * @returns ms; 0 when nothing is left.
 */
function pauseOf(history: PerfHistory, row: number): number {
  const gpu = history.gpuMs[row] ?? Number.NaN;
  const left = (history.ms[row] ?? 0) - (history.jsMs[row] ?? 0) - (Number.isNaN(gpu) ? 0 : gpu);
  return Math.max(0, Math.round(left * 10) / 10);
}

/**
 * The tooltip's last line: what the frame was (a resting frame at its rest rate, its budget's).
 *
 * @param history - The history.
 * @param row - The frame's row.
 * @param gc - The GC the frame's events name, when shown.
 * @returns The line.
 */
function lineOf(history: PerfHistory, row: number, gc: GcEvent | undefined): string {
  const rest = history.rest[row];
  const ms = history.ms[row] ?? 0;
  const budget = history.budgetMs[row] ?? 0;
  if (rest === REST.idle || rest === REST.break) {
    return `Resting at ${restFpsAt(history, row)} fps, not a problem`;
  }
  const cause = causeName(spikeCodeAt(history, row));
  if (cause !== undefined) {
    return `${CAUSE_LABELS[cause]}, ${oneDecimal(Math.max(0, ms - budget))} ms over budget`;
  }
  if (gc !== undefined) {
    const pause = pauseOf(history, row);
    const freed = `GC freed ${oneDecimal(gc.freedMb)} MB`;
    return pause > 0 ? `${freed}, pause ${oneDecimal(pause)} ms` : freed;
  }
  return ms > budget ? "Over budget" : "Within budget";
}

/**
 * The tooltip of a frame of the history.
 *
 * @param history - The history.
 * @param frame - The hovered frame.
 * @param options - The sections and the clock.
 * @returns The tooltip; undefined when the history does not hold the frame.
 * @example
 * ```ts
 * tooltipOf(history, 4851, { gpu: "on", passes: true, gpuMhz: null, gcShown: true })?.line; // "GPU sustained, 4.9 ms over budget"
 * ```
 */
export function tooltipOf(
  history: PerfHistory,
  frame: number,
  options: TooltipOptions
): TooltipView | undefined {
  const row = rowOfFrame(history, frame);
  if (row < 0) return undefined;
  const { gc, compile } = eventsOfFrame(history, frame);
  const shownGc = options.gcShown ? gc : undefined;
  const rows: TooltipRow[] = [
    { label: "JS", value: oneDecimal(history.jsMs[row] ?? 0) },
    { label: "GPU", value: gpuValue(history.gpuMs[row] ?? Number.NaN, options) },
    { label: "Rate", value: `${frameFpsAt(history, row)} fps` }
  ];
  const pause = shownGc === undefined ? 0 : pauseOf(history, row);
  if (pause > 0) rows.push({ label: "GC pause", value: oneDecimal(pause) });
  const passes = options.passes ? framePassGpu(history, frame) : Number.NaN;
  if (!Number.isNaN(passes)) rows.push({ label: "Passes", value: oneDecimal(passes) });
  if (compile !== undefined) {
    rows.push({
      label: `Compile ${compile.label ?? compile.what}`,
      value: compile.ms === null ? "—" : oneDecimal(compile.ms)
    });
  }
  return {
    frame: `f${frame}`,
    ms: `${oneDecimal(history.ms[row] ?? 0)} ms`,
    rows,
    line: lineOf(history, row, shownGc)
  };
}
