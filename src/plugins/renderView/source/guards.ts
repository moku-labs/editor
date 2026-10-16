/**
 * @file renderView source — the guards of the values Mission control reads (spec 09 § M14, M4 note):
 * a value of another shape is dropped (and warned by the caller), never shown. Each checks the fields
 * Mission control reads; the optional fields of the 2026-10-16 delta (`monitor`, `memory`, `caps`,
 * `epoch`) are checked when present, so an older agent's value still passes.
 */
import type { Json } from "../../registry/protocol";
import type {
  PerfDetailWire,
  PerfEventsWire,
  PerfPassesWire,
  PerfSecond,
  RecorderSource
} from "./contract";
import { readFramesWire } from "./contract";

/**
 * A field of an object.
 *
 * @param value - Any value.
 * @param key - The field.
 * @returns The field; undefined for a value that is not an object.
 */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

/**
 * Whether a value is an object (not null, not an array).
 *
 * @param value - Any value.
 * @returns Whether it is one.
 */
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a JSON value is an object.
 *
 * @param value - A JSON value.
 * @returns Whether it is one.
 */
function isJsonObject(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a finite number.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Whether a value is a number or null.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 */
function isNumberOrNull(value: unknown): boolean {
  return value === null || isNumber(value);
}

/**
 * Whether a value is a string or null.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 */
function isTextOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

/**
 * Whether an optional field is absent or passes its check.
 *
 * @param value - The object.
 * @param key - The field.
 * @param check - Its check when present.
 * @returns Whether it passes.
 */
function optional(value: unknown, key: string, check: (field: unknown) => boolean): boolean {
  const field = fieldOf(value, key);
  return field === undefined || check(field);
}

/**
 * Whether a value is a monitoring state (`second.monitor`, the `editor.perf.sections` answer).
 *
 * @param value - Any value.
 * @returns Whether it has the shape.
 */
function isMonitor(value: unknown): boolean {
  return (
    typeof fieldOf(value, "engine") === "boolean" &&
    isObject(fieldOf(value, "sections")) &&
    isObject(fieldOf(value, "feeds"))
  );
}

/**
 * Whether a value is the rate of a second.
 *
 * @param value - Any value.
 * @returns Whether it has the shape.
 */
function isRate(value: unknown): boolean {
  return (
    isNumberOrNull(fieldOf(value, "fps")) &&
    isTextOrNull(fieldOf(value, "mode")) &&
    isNumberOrNull(fieldOf(value, "displayHz"))
  );
}

/** The states of a second. */
const SECOND_STATES: ReadonlySet<unknown> = new Set(["on", "waiting", "off"]);

/**
 * Whether a value is a PerfSecond: its state, fps, spikes, budget, rate, sample and the facts
 * Mission control reads; `monitor`, `memory`, `caps` and `epoch` checked when present.
 *
 * @param value - A watched `editor.perf.second` value.
 * @returns True for a PerfSecond.
 * @example
 * ```ts
 * isPerfSecond({ state: "on" }); // false: no fps, spikes, budget or rate
 * ```
 */
export function isPerfSecond(value: unknown): value is PerfSecond {
  const fps = fieldOf(value, "fps");
  return (
    SECOND_STATES.has(fieldOf(value, "state")) &&
    isNumber(fieldOf(fps, "loop")) &&
    isNumber(fieldOf(fps, "drawn")) &&
    isNumber(fieldOf(value, "spikes")) &&
    isNumber(fieldOf(value, "budgetMs")) &&
    isRate(fieldOf(value, "rate")) &&
    (fieldOf(value, "sample") === null || isObject(fieldOf(value, "sample"))) &&
    optional(value, "monitor", isMonitor) &&
    optional(value, "memory", memory => typeof fieldOf(memory, "trusted") === "boolean") &&
    optional(value, "caps", isObject) &&
    optional(value, "epoch", isTextOrNull)
  );
}

/** The sources of a passes wire. */
const PASS_SOURCES: ReadonlySet<unknown> = new Set(["agent", "engine"]);

/**
 * Whether a value is a PerfPassesWire (the raw second of `editor.perf.passes`).
 *
 * @param value - A watched `editor.perf.passes` value.
 * @returns True for a PerfPassesWire.
 * @example
 * ```ts
 * isPassesWire(null); // false: the agent's "no full second yet" is handled before
 * ```
 */
export function isPassesWire(value: unknown): value is PerfPassesWire {
  const rows = fieldOf(value, "rows");
  const heaviest = fieldOf(value, "heaviest");
  const line = fieldOf(value, "line");
  return (
    fieldOf(value, "v") === 1 &&
    PASS_SOURCES.has(fieldOf(value, "source")) &&
    isNumber(fieldOf(value, "t")) &&
    isNumber(fieldOf(value, "frames")) &&
    typeof fieldOf(value, "tiler") === "boolean" &&
    typeof fieldOf(value, "gpuTimer") === "boolean" &&
    (rows === null || Array.isArray(fieldOf(rows, "row"))) &&
    (heaviest === null || isNumber(fieldOf(heaviest, "frame"))) &&
    (line === null || Array.isArray(fieldOf(line, "chains"))) &&
    isNumber(fieldOf(value, "lost"))
  );
}

/* eslint-disable unicorn/no-null -- null is a value the wire carries: no source, no reason */
/** The detail's sources and reasons. */
const DETAIL_SOURCES: ReadonlySet<unknown> = new Set(["engine", "agent", null]);
const DETAIL_REASONS: ReadonlySet<unknown> = new Set([
  "no-detail",
  "control",
  "failed",
  "gone",
  null
]);
/* eslint-enable unicorn/no-null */
const NODE_HOWS: ReadonlySet<unknown> = new Set(["mark", "moved", "loose", "invalidate", "redraw"]);

/**
 * Whether a value is one node of a detail answer.
 *
 * @param node - Any value.
 * @returns Whether it has the shape.
 */
function isNode(node: unknown): boolean {
  return (
    isNumber(fieldOf(node, "entity")) &&
    isTextOrNull(fieldOf(node, "label")) &&
    NODE_HOWS.has(fieldOf(node, "how")) &&
    isNumber(fieldOf(node, "count"))
  );
}

/**
 * Whether a value is a PerfDetailWire (its frames checked with readFramesWire, its nodes each).
 *
 * @param value - An `editor.perf.detail` answer.
 * @returns True for a PerfDetailWire.
 * @example
 * ```ts
 * isDetailWire({ v: 1, from: 4810, to: 4860, source: null, reason: "gone", frames: null, nodes: null }); // true
 * ```
 */
export function isDetailWire(value: Json): value is Json & PerfDetailWire {
  const frames = isJsonObject(value) ? value.frames : undefined;
  const nodes = fieldOf(value, "nodes");
  return (
    fieldOf(value, "v") === 1 &&
    isNumber(fieldOf(value, "from")) &&
    isNumber(fieldOf(value, "to")) &&
    DETAIL_SOURCES.has(fieldOf(value, "source")) &&
    DETAIL_REASONS.has(fieldOf(value, "reason")) &&
    (frames === null || (frames !== undefined && readFramesWire(frames) !== undefined)) &&
    (nodes === null || (Array.isArray(nodes) && nodes.every(node => isNode(node))))
  );
}

/**
 * Whether a value is a PerfEventsWire (raw lines; `eventsOf` skips a broken item).
 *
 * @param value - An `editor.perf.events` answer.
 * @returns True for a PerfEventsWire.
 * @example
 * ```ts
 * isEventsWire({ v: 1, epoch: null, timeOrigin: null, next: 0, lost: false, items: [] }); // true
 * ```
 */
export function isEventsWire(value: unknown): value is PerfEventsWire {
  return (
    fieldOf(value, "v") === 1 &&
    isTextOrNull(fieldOf(value, "epoch")) &&
    isNumberOrNull(fieldOf(value, "timeOrigin")) &&
    isNumber(fieldOf(value, "next")) &&
    typeof fieldOf(value, "lost") === "boolean" &&
    Array.isArray(fieldOf(value, "items"))
  );
}

/** The recorder's states and starters. */
const RECORDER_STATES: ReadonlySet<unknown> = new Set(["idle", "recording", "exporting"]);
const STARTERS: ReadonlySet<unknown> = new Set([
  "phone",
  "editor",
  "agent",
  "remote",
  "code",
  "auto"
]);

/**
 * Whether a value is who started a log, or null.
 *
 * @param value - Any value.
 * @returns Whether it has the shape.
 */
function isOrigin(value: unknown): boolean {
  return (
    value === null || (STARTERS.has(fieldOf(value, "by")) && isTextOrNull(fieldOf(value, "name")))
  );
}

/**
 * Whether a value is a mark of a log.
 *
 * @param mark - Any value.
 * @returns Whether it has the shape.
 */
function isMark(mark: unknown): boolean {
  return (
    isNumber(fieldOf(mark, "atMs")) &&
    typeof fieldOf(mark, "label") === "string" &&
    typeof fieldOf(mark, "auto") === "boolean"
  );
}

/**
 * Whether a value is a RecorderSource (status, startedBy and marks).
 *
 * @param value - A watched `editor.recorder` value.
 * @returns True for a RecorderSource.
 * @example
 * ```ts
 * isRecorderSource({ state: "recording" }); // false: no numbers, no marks
 * ```
 */
export function isRecorderSource(value: unknown): value is RecorderSource {
  const marks = fieldOf(value, "marks");
  return (
    RECORDER_STATES.has(fieldOf(value, "state")) &&
    ["lines", "bytes", "sinceMs"].every(key => isNumber(fieldOf(value, key))) &&
    isTextOrNull(fieldOf(value, "file")) &&
    isOrigin(fieldOf(value, "startedBy")) &&
    Array.isArray(marks) &&
    marks.every(mark => isMark(mark))
  );
}
