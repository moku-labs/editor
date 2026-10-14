/**
 * @file renderView device strip — shape guards of the values the strip watches and reads
 * (`editor.perf.second`, `editor.perf.spikes`, `editor.perf.spike`, `editor.recorder`). The values
 * come off the wire as Json: each guard checks every member `derive.ts` and `record.ts` read
 * (spec 09 § State, "PerfSecond fields read"; § Derivation rules) down to its type, so a value
 * that passes never makes them throw; a cause must be one of `CAUSE_STYLE`. A value of another
 * shape is refused and the strip keeps its last good one. No guard throws.
 */
import type { PerfCause } from "../../perf/protocol";
import type { PerfSecond, PerfSpikeRecord, PerfSpikeSummary, RecorderStatus } from "./contract";
import { CAUSE_STYLE } from "./contract";

/**
 * A decoded JSON object whose members are not checked yet.
 */
type Unchecked = { readonly [key: string]: unknown };

/**
 * A check of one member.
 */
type Check = (value: unknown) => boolean;

/**
 * True for a plain object (not null, not an array).
 *
 * @param value - A value off the wire.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject({ a: 1 }); // true
 * ```
 */
function isObject(value: unknown): value is Unchecked {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a finite number.
 *
 * @param value - A member.
 * @returns Whether it is a number.
 * @example
 * ```ts
 * isNumber(Number.NaN); // false
 * ```
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * True for a string.
 *
 * @param value - A member.
 * @returns Whether it is text.
 * @example
 * ```ts
 * isText("garden/boss"); // true
 * ```
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * True for null, or a value that passes the check: a member the engine may leave out.
 *
 * @param value - A member.
 * @param check - The check of a present value.
 * @returns Whether it is null or passes.
 * @example
 * ```ts
 * nullOr(null, isNumber); // true
 * ```
 */
function nullOr(value: unknown, check: Check): boolean {
  return value === null || check(value);
}

/**
 * True for null or a finite number.
 *
 * @param value - A member.
 * @returns Whether it is a number or null.
 * @example
 * ```ts
 * isNumberOrNull(16.7); // true
 * ```
 */
function isNumberOrNull(value: unknown): boolean {
  return nullOr(value, isNumber);
}

/**
 * True for null or a string.
 *
 * @param value - A member.
 * @returns Whether it is a string or null.
 * @example
 * ```ts
 * isTextOrNull("debug-20261014T160000Z"); // true
 * ```
 */
function isTextOrNull(value: unknown): boolean {
  return nullOr(value, isText);
}

/**
 * True for an object whose named members are all finite numbers.
 *
 * @param value - A member.
 * @param keys - The members that must be numbers.
 * @returns Whether it is such an object.
 * @example
 * ```ts
 * hasNumbers({ w: 1080, h: 2340 }, ["w", "h"]); // true
 * ```
 */
function hasNumbers(value: unknown, keys: readonly string[]): boolean {
  return isObject(value) && keys.every(key => isNumber(value[key]));
}

/**
 * True for an array whose items all pass the check.
 *
 * @param value - A member.
 * @param check - The check of one item.
 * @returns Whether it is such a list.
 * @example
 * ```ts
 * isListOf([1, 2], isNumber); // true
 * ```
 */
function isListOf(value: unknown, check: Check): boolean {
  return Array.isArray(value) && value.every(item => check(item));
}

/**
 * True for one of the causes the strip knows a legend, a word and a hue for.
 *
 * @param value - A member.
 * @returns Whether it is a known cause.
 * @example
 * ```ts
 * isCause("upload"); // true
 * isCause("toString"); // false
 * ```
 */
function isCause(value: unknown): value is PerfCause {
  return isText(value) && Object.hasOwn(CAUSE_STYLE, value);
}

/**
 * True for `{ mean }` with a number: the sample's passes, draws and filter applies.
 *
 * @param value - A member.
 * @returns Whether it has a numeric mean.
 * @example
 * ```ts
 * hasMean({ mean: 6.2, max: 9 }); // true
 * ```
 */
function hasMean(value: unknown): boolean {
  return hasNumbers(value, ["mean"]);
}

/**
 * True for one system of a sample: its name and mean ms.
 *
 * @param value - One item.
 * @returns Whether it is a sample system.
 * @example
 * ```ts
 * isSampleSystem({ name: "ripple", mean: 1.4, max: 2 }); // true
 * ```
 */
function isSampleSystem(value: unknown): boolean {
  return isObject(value) && isText(value.name) && isNumber(value.mean);
}

/**
 * True for the sample members the headline and More read.
 *
 * @param value - `PerfSecond.sample`, not null.
 * @returns Whether every read member has its type.
 */
function isSample(value: unknown): boolean {
  if (!isObject(value) || !isNumber(value.ticks) || !isNumber(value.views)) return false;
  if (!isNumberOrNull(value.heapMb) || !hasNumbers(value.textures, ["art", "targets", "kept"])) {
    return false;
  }
  const means = [value.passes, value.draws].every(member => nullOr(member, hasMean));
  const filters = nullOr(value.filters, item => isObject(item) && hasMean(item.applies));
  const systems = nullOr(value.systems, item => isListOf(item, isSampleSystem));
  return means && filters && systems && nullOr(value.gapMs, item => hasNumbers(item, ["p90"]));
}

/**
 * True for the display members the device row and More read.
 *
 * @param value - `PerfSecond.display`, not null.
 * @returns Whether every read member has its type.
 */
function isDisplay(value: unknown): boolean {
  if (!hasNumbers(value, ["dpr", "resolution"]) || !isObject(value)) return false;
  const canvas = hasNumbers(value.canvas, ["w", "h"]);
  return canvas && hasNumbers(value.safeArea, ["t", "r", "b", "l"]) && isText(value.backend);
}

/**
 * True for the renderer stats More reads: numbers or null, and kept pictures when present.
 *
 * @param value - `PerfSecond.render`, not null.
 * @returns Whether every read member has its type.
 */
function isRender(value: unknown): boolean {
  if (!isObject(value)) return false;
  const counts = [value.passesMax, value.redraws, value.rebuilds].every(member =>
    isNumberOrNull(member)
  );
  return counts && nullOr(value.kept, item => hasNumbers(item, ["pictures", "mb", "retakes"]));
}

/**
 * True for the device members the model and the about line read.
 *
 * @param value - `PerfSecond.device`, not null.
 * @returns Whether every read member has its type.
 */
function isHeaderDevice(value: unknown): boolean {
  return (
    isObject(value) &&
    isText(value.userAgent) &&
    isTextOrNull(value.model) &&
    isTextOrNull(value.webview)
  );
}

/**
 * The perf states.
 */
const PERF_STATES: ReadonlySet<unknown> = new Set(["on", "waiting", "off"]);

/**
 * True for the rate the headline's suffix reads.
 *
 * @param value - `PerfSecond.rate`.
 * @returns Whether every read member has its type.
 */
function isRate(value: unknown): boolean {
  if (!isObject(value) || !isNumber(value.switches)) return false;
  return (
    isNumberOrNull(value.fps) &&
    isNumberOrNull(value.displayHz) &&
    isTextOrNull(value.mode) &&
    isTextOrNull(value.reason)
  );
}

/**
 * True for an `editor.perf.second` value: its state, fps, spike count, budget and rate, and every
 * member of its sample, display, render, device and gpu the strip reads.
 *
 * @param value - The value.
 * @returns Whether it is a PerfSecond.
 * @example
 * ```ts
 * isPerfSecond({ state: "waiting" }); // false: no fps
 * ```
 */
export function isPerfSecond(value: unknown): value is PerfSecond {
  if (!isObject(value) || !PERF_STATES.has(value.state) || !isRate(value.rate)) return false;
  if (!hasNumbers(value.fps, ["loop", "drawn"])) return false;
  if (!isNumber(value.spikes) || !isNumber(value.budgetMs)) return false;
  if (!isTextOrNull(value.build) || !isTextOrNull(value.engine)) return false;
  return (
    nullOr(value.sample, isSample) &&
    nullOr(value.display, isDisplay) &&
    nullOr(value.render, isRender) &&
    nullOr(value.device, isHeaderDevice) &&
    nullOr(value.gpu, item => isObject(item) && isText(item.backend))
  );
}

/**
 * True for one spike summary: frame, times, a known primary cause and only known causes.
 *
 * @param value - One item.
 * @returns Whether it is a PerfSpikeSummary.
 * @example
 * ```ts
 * isSpikeSummary({ frame: 4812 }); // false
 * ```
 */
function isSpikeSummary(value: unknown): value is PerfSpikeSummary {
  if (!hasNumbers(value, ["frame", "agoMs", "ms", "budgetMs", "overMs", "jsMs"])) return false;
  if (!isObject(value) || !isCause(value.cause) || !isListOf(value.causes, isCause)) return false;
  return isText(value.why) && isText(value.path) && isNumberOrNull(value.gpuMs);
}

/**
 * True for an `editor.perf.spikes` value: a list of spike summaries.
 *
 * @param value - The value.
 * @returns Whether it is the list.
 * @example
 * ```ts
 * isSpikeList([]); // true
 * ```
 */
export function isSpikeList(value: unknown): value is readonly PerfSpikeSummary[] {
  return isListOf(value, isSpikeSummary);
}

/**
 * The phases of a frame, in the record's order.
 */
const PHASE_KEYS = ["input", "animate", "layout", "sync", "signals", "render", "agent"] as const;

/**
 * True for one game frame event "what changed" lists: an overlay (label, what), a pool trim
 * (reason, MB freed) or a warm-up (draws).
 *
 * @param value - One item.
 * @returns Whether it is a PerfFrameEvent.
 * @example
 * ```ts
 * isFrameEvent({ kind: "warm", frame: 4812, draws: 12 }); // true
 * ```
 */
function isFrameEvent(value: unknown): boolean {
  if (!isObject(value) || !isNumber(value.frame)) return false;
  if (value.kind === "overlay") return isText(value.label) && isText(value.what);
  if (value.kind === "pool-trim") return isText(value.reason) && isNumber(value.freedMb);
  return value.kind === "warm" && isNumber(value.draws);
}

/**
 * True for the engine's frame inside its spike line: its changes and its phases.
 *
 * @param value - `PerfSpikeLine.frame`.
 * @returns Whether every read member has its type.
 */
function isLineFrame(value: unknown): boolean {
  if (!isObject(value) || !hasNumbers(value.phases, PHASE_KEYS)) return false;
  return isListOf(
    value.changed,
    change => isObject(change) && isText(change.kind) && isTextOrNull(change.what)
  );
}

/**
 * True for the engine's spike line (the record's `detail`): its frame, passes, systems, filters
 * and long frames.
 *
 * @param value - `PerfSpikeRecord.detail`, not null.
 * @returns Whether every read member has its type.
 */
function isSpikeLine(value: unknown): boolean {
  if (!isObject(value) || !isLineFrame(value.frame)) return false;
  const passes = isListOf(
    value.passes,
    pass =>
      isObject(pass) && isText(pass.kind) && isTextOrNull(pass.label) && isNumberOrNull(pass.gpuMs)
  );
  const systems = nullOr(value.systems, list =>
    isListOf(list, system => isObject(system) && isText(system.name) && isNumber(system.ms))
  );
  const filters = isListOf(
    value.filters,
    filter => isObject(filter) && isText(filter.kind) && hasNumbers(filter, ["applies", "mpx"])
  );
  return (
    passes &&
    systems &&
    filters &&
    isListOf(value.longFrames, item => hasNumbers(item, ["durationMs"]))
  );
}

/**
 * True for the record's own numbers: phases, filters, uploads and the rate switch, each null or
 * whole.
 *
 * @param record - The record object.
 * @returns Whether every read member has its type.
 */
function hasRecordNumbers(record: Unchecked): boolean {
  const counts = [record.passes, record.draws, record.compiles].every(member =>
    isNumberOrNull(member)
  );
  return (
    counts &&
    nullOr(record.phases, item => hasNumbers(item, PHASE_KEYS)) &&
    nullOr(record.filters, item => hasNumbers(item, ["applies", "mpx"])) &&
    nullOr(record.uploads, item => hasNumbers(item, ["count", "mb"])) &&
    nullOr(record.rateSwitch, item => hasNumbers(item, ["from", "to"]))
  );
}

/**
 * True for an `editor.perf.spike` answer: a summary plus every member of the record and its
 * engine line the side panel reads.
 *
 * @param value - The answer (null is checked by the caller).
 * @returns Whether it is a PerfSpikeRecord.
 * @example
 * ```ts
 * isSpikeRecord({ frame: 4812 }); // false
 * ```
 */
export function isSpikeRecord(value: unknown): value is PerfSpikeRecord {
  if (!isObject(value) || !isSpikeSummary(value)) return false;
  const record: Unchecked = value;
  if (!isNumber(record.fps) || !isListOf(record.changed, isText)) return false;
  if (!isListOf(record.events, isFrameEvent) || !hasRecordNumbers(record)) return false;
  return nullOr(record.detail, isSpikeLine);
}

/**
 * The recorder states.
 */
const RECORDER_STATES: ReadonlySet<unknown> = new Set(["idle", "recording", "exporting"]);

/**
 * True for an `editor.recorder` value: its state and the clock of the log.
 *
 * @param value - The value.
 * @returns Whether it is a RecorderStatus.
 * @example
 * ```ts
 * isRecorderStatus({ state: "idle", sinceMs: 0 }); // true
 * ```
 */
export function isRecorderStatus(value: unknown): value is RecorderStatus {
  return isObject(value) && RECORDER_STATES.has(value.state) && isNumber(value.sinceMs);
}
