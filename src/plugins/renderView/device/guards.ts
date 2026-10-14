/**
 * @file renderView device strip — shape guards of the values the strip watches and reads
 * (`editor.perf.second`, `editor.perf.spikes`, `editor.perf.spike`, `editor.recorder`). The values
 * come off the wire as Json: each guard checks the fields the strip reads (spec 09 § State,
 * "PerfSecond fields read") and narrows to the owner's type; a value of another shape is refused
 * and the strip keeps its last good one.
 */
import type { PerfSecond, PerfSpikeRecord, PerfSpikeSummary, RecorderStatus } from "./contract";

/**
 * A decoded JSON object whose members are not checked yet.
 */
type Unchecked = { readonly [key: string]: unknown };

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
 * True for null or a plain object: a nested value the engine may leave out.
 *
 * @param value - A member.
 * @returns Whether it is null or an object.
 * @example
 * ```ts
 * isObjectOrNull(null); // true
 * ```
 */
function isObjectOrNull(value: unknown): boolean {
  return value === null || isObject(value);
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
  return value === null || (typeof value === "number" && Number.isFinite(value));
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
  return value === null || typeof value === "string";
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
 * The perf states.
 */
const PERF_STATES: ReadonlySet<unknown> = new Set(["on", "waiting", "off"]);

/**
 * True for an `editor.perf.second` value: its state, fps, spike count, budget and rate, and every
 * nested part null or an object.
 *
 * @param value - The value.
 * @returns Whether it is a PerfSecond.
 * @example
 * ```ts
 * isPerfSecond({ state: "waiting" }); // false: no fps
 * ```
 */
export function isPerfSecond(value: unknown): value is PerfSecond {
  if (!isObject(value) || !PERF_STATES.has(value.state)) return false;
  const { fps, rate } = value;
  if (!isObject(fps) || !isNumber(fps.loop) || !isNumber(fps.drawn)) return false;
  if (!isNumber(value.spikes) || !isNumber(value.budgetMs)) return false;
  if (!isObject(rate) || !isNumber(rate.switches) || !isNumberOrNull(rate.fps)) return false;
  if (!isNumberOrNull(rate.displayHz) || !isTextOrNull(rate.mode)) return false;
  const nested = [value.render, value.sample, value.display, value.device, value.gpu];
  return (
    nested.every(item => isObjectOrNull(item)) &&
    isTextOrNull(value.build) &&
    isTextOrNull(value.engine)
  );
}

/**
 * True for one spike summary: frame, times, the primary cause and the list of causes.
 *
 * @param value - One item.
 * @returns Whether it is a PerfSpikeSummary.
 * @example
 * ```ts
 * isSpikeSummary({ frame: 4812 }); // false
 * ```
 */
function isSpikeSummary(value: unknown): value is PerfSpikeSummary {
  if (!isObject(value) || !isNumber(value.frame) || !isNumber(value.agoMs)) return false;
  if (!isNumber(value.ms) || !isNumber(value.budgetMs) || !isNumber(value.overMs)) return false;
  if (typeof value.cause !== "string" || !Array.isArray(value.causes)) return false;
  return typeof value.why === "string" && typeof value.path === "string";
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
  return Array.isArray(value) && value.every(item => isSpikeSummary(item));
}

/**
 * True for an `editor.perf.spike` answer: a summary plus the record's numbers.
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
  if (!isNumber(record.fps) || !Array.isArray(record.changed) || !Array.isArray(record.events)) {
    return false;
  }
  const nested = [record.rateSwitch, record.phases, record.filters, record.uploads, record.detail];
  return nested.every(item => isObjectOrNull(item)) && isNumberOrNull(record.gpuMs);
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
