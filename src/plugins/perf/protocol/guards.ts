/**
 * @file perf/protocol — the guards perf reads the engine through: the monitor and the render stats
 * of a game, the off reason, and the shapes of the event details it keeps (`display`, `rate`, the
 * game's frame events). Every guard reads structurally and never throws: a getter that throws counts
 * as a missing field. Runtime-free.
 */
import type {
  GcEventDetail,
  MonitorLike,
  OverlayWhat,
  PerfDisplay,
  PerfEventLine,
  PerfHeaderLine,
  PoolTrimDetail,
  ProblemEventDetail,
  RateChange,
  RateMode,
  RateReason,
  ShaderEventDetail,
  ThermalStatus
} from "./engine";
import type { PerfCaps, PerfFrameEvent, PerfOffReason, PerfRenderStats } from "./values";

/** The members a monitor must have as functions for perf to use it (11:1153-1158). */
const MONITOR_MEMBERS = ["stream", "frames", "mark", "event", "beginAgent", "endAgent"] as const;

/** What a game overlay did (spec 22 O10.2). */
const OVERLAY_WHATS: readonly OverlayWhat[] = ["open", "landed", "leave", "gone", "live", "kept"];

/** Why the filter texture pool was trimmed (spec 25 M1.8). */
const TRIM_REASONS: readonly PoolTrimDetail["reason"][] = ["rest", "scene", "pause"];

/** The rate modes of spec 21. */
const RATE_MODES: readonly RateMode[] = ["fixed", "auto", "forced"];

/** The rate reasons of spec 21. */
const RATE_REASONS: readonly RateReason[] = [
  "start",
  "display",
  "missed",
  "headroom",
  "thermal",
  "forced",
  "auto"
];

/** The severities of a flagged problem (N3). */
const SEVERITIES: readonly ("info" | "warn")[] = ["info", "warn"];

/** Why `filter-still` flagged a filter (engine U5). */
const STILL_REASONS: readonly ("budget" | "not-eligible")[] = ["budget", "not-eligible"];

/** The number fields of a flagged problem, each a number or null. */
const PROBLEM_NUMBERS = ["value", "threshold", "since", "frames"] as const;

/** What the recorder did, in its own `recorder` event lines. */
const RECORDER_ACTIONS: readonly ("start" | "stop" | "export")[] = ["start", "stop", "export"];

/** The thermal statuses of spec 21. */
const THERMAL_STATUSES: readonly ThermalStatus[] = [
  "none",
  "light",
  "moderate",
  "severe",
  "critical",
  "emergency",
  "shutdown"
];

/**
 * Reads one field of any value; a primitive is boxed, a getter that throws answers undefined.
 *
 * @param value - Any value.
 * @param key - The field.
 * @returns The field's value, or undefined.
 * @example
 * ```ts
 * fieldOf({ renderer: 1 }, "renderer"); // 1
 * ```
 */
function fieldOf(value: unknown, key: string): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    return Reflect.get(Object(value), key);
  } catch {
    return undefined;
  }
}

/**
 * Whether a value is an object (not null, functions included).
 *
 * @param value - Any value.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject(null); // false
 * ```
 */
function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Whether a value is a finite number.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A finite number, else null.
 *
 * @param value - Any value.
 * @returns The number, or null.
 * @example
 * ```ts
 * finiteOrNull(undefined); // null
 * ```
 */
function finiteOrNull(value: unknown): number | null {
  // eslint-disable-next-line unicorn/no-null -- null is "the engine does not answer it"
  return isFiniteNumber(value) ? value : null;
}

/**
 * Whether the named fields of a value are all finite numbers.
 *
 * @param value - Any value.
 * @param keys - The fields.
 * @returns Whether every field is a finite number.
 * @example
 * ```ts
 * hasNumbers({ w: 1080, h: 2340 }, ["w", "h"]); // true
 * ```
 */
function hasNumbers(value: unknown, keys: readonly string[]): boolean {
  return isObject(value) && keys.every(key => isFiniteNumber(fieldOf(value, key)));
}

/**
 * Whether a value is one of a list of strings.
 *
 * @param value - Any value.
 * @param list - The allowed strings.
 * @returns Whether `value` is in it.
 * @example
 * ```ts
 * isOneOf("kept", OVERLAY_WHATS); // true
 * ```
 */
function isOneOf<Item extends string>(value: unknown, list: readonly Item[]): value is Item {
  return (list as readonly unknown[]).includes(value);
}

/**
 * Whether an object has every member perf calls on a monitor, each a function.
 *
 * @param value - The `renderer.monitor` of a game.
 * @returns Whether it is a monitor.
 * @example
 * ```ts
 * isMonitor({ stream() {} }); // false: frames, mark, event, beginAgent, endAgent are missing
 * ```
 */
function isMonitor(value: object): value is MonitorLike {
  return MONITOR_MEMBERS.every(key => typeof fieldOf(value, key) === "function");
}

/**
 * The engine's performance monitor of a game: `game.renderer.monitor` when it has `stream`,
 * `frames`, `mark`, `event`, `beginAgent` and `endAgent` as functions. Never throws.
 *
 * @param game - The game app (any value).
 * @returns The monitor, or undefined.
 * @example
 * ```ts
 * monitorOf({ time: {}, flow: {} }); // undefined: a headless game has no renderer
 * ```
 */
export function monitorOf(game: unknown): MonitorLike | undefined {
  const monitor = fieldOf(fieldOf(game, "renderer"), "monitor");
  return isObject(monitor) && isMonitor(monitor) ? monitor : undefined;
}

/**
 * Why a game has no monitor perf can use.
 *
 * @param game - The game app (any value).
 * @returns "no-renderer" without a renderer object, "no-monitor" with one but no usable monitor,
 *   undefined when a monitor exists.
 * @example
 * ```ts
 * offReasonOf({ renderer: {} }); // "no-monitor": an engine before block 2b
 * ```
 */
export function offReasonOf(game: unknown): PerfOffReason | undefined {
  if (!isObject(fieldOf(game, "renderer"))) return "no-renderer";
  return monitorOf(game) === undefined ? "no-monitor" : undefined;
}

/**
 * Whether a value has the shape of a `PerfDisplay` (11:960-964).
 *
 * @param value - The detail of a `display` event.
 * @returns Whether it is a display.
 * @example
 * ```ts
 * isPerfDisplay({ dpr: 2 }); // false: canvas, css, safeArea, backend and orientation are missing
 * ```
 */
export function isPerfDisplay(value: unknown): value is PerfDisplay {
  return (
    hasNumbers(value, ["dpr", "resolution", "maxResolution"]) &&
    hasNumbers(fieldOf(value, "canvas"), ["w", "h"]) &&
    hasNumbers(fieldOf(value, "css"), ["w", "h"]) &&
    hasNumbers(fieldOf(value, "safeArea"), ["t", "r", "b", "l"]) &&
    isOneOf(fieldOf(value, "backend"), ["webgpu", "webgl", "none"]) &&
    isOneOf(fieldOf(value, "orientation"), ["portrait", "landscape"])
  );
}

/**
 * The `kept` of a render stats answer: an object with three finite numbers, else null.
 *
 * @param value - `stats().kept`.
 * @returns The copy, or null.
 * @example
 * ```ts
 * keptOf({ pictures: 1, mb: 1.4, retakes: 0 }); // { pictures: 1, mb: 1.4, retakes: 0 }
 * ```
 */
function keptOf(value: unknown): PerfRenderStats["kept"] {
  if (!hasNumbers(value, ["pictures", "mb", "retakes"])) {
    // eslint-disable-next-line unicorn/no-null -- null is "an engine before spec 23"
    return null;
  }

  return {
    pictures: Number(fieldOf(value, "pictures")),
    mb: Number(fieldOf(value, "mb")),
    retakes: Number(fieldOf(value, "retakes"))
  };
}

/**
 * What perf reads from `game.renderer.stats()`: calls it once and copies `renderPassesMax`, `kept`,
 * `redraws`, `rebuilds`, each null where the engine does not answer it. Never throws.
 *
 * @param game - The game app (any value).
 * @returns The copy; undefined when there is no `stats` function or the call throws.
 * @example
 * ```ts
 * statsOf({ renderer: { stats: () => ({ renderPasses: 1 }) } });
 * // { passesMax: null, kept: null, redraws: null, rebuilds: null }: an engine before spec 23
 * ```
 */
export function statsOf(game: unknown): PerfRenderStats | undefined {
  const renderer = fieldOf(game, "renderer");
  const stats = fieldOf(renderer, "stats");
  if (typeof stats !== "function") return undefined;

  let answer: unknown;
  try {
    answer = Reflect.apply(stats, renderer, []);
  } catch {
    return undefined;
  }

  return {
    passesMax: finiteOrNull(fieldOf(answer, "renderPassesMax")),
    kept: keptOf(fieldOf(answer, "kept")),
    redraws: finiteOrNull(fieldOf(answer, "redraws")),
    rebuilds: finiteOrNull(fieldOf(answer, "rebuilds"))
  };
}

/**
 * The display's refresh rate the engine learned: `game.time.rate().displayHz` (spec 21), read
 * structurally. The engine's stream does not announce it until the rate itself changes, so perf asks
 * the game. Never throws.
 *
 * @param game - The game app (any value).
 * @returns The Hz; null when unknown, without `time.rate`, or when the call throws.
 * @example
 * ```ts
 * displayHzOf({ time: { rate: () => ({ fps: 60, displayHz: 60 }) } }); // 60
 * ```
 */
export function displayHzOf(game: unknown): number | null {
  const time = fieldOf(game, "time");
  const rate = fieldOf(time, "rate");
  // eslint-disable-next-line unicorn/no-null -- null is "the engine has not learned the display's rate"
  if (typeof rate !== "function") return null;
  let answer: unknown;
  try {
    answer = Reflect.apply(rate, time, []);
  } catch {
    // eslint-disable-next-line unicorn/no-null -- as above
    return null;
  }
  return finiteOrNull(fieldOf(answer, "displayHz"));
}

/**
 * The display's refresh rate as a newer engine announces it in its display (engine diagnosis
 * 2026-10-15: `PerfDisplay` gains `hz`, and a `display` event follows each change), read
 * structurally: the engine before it has no `hz`. Preferred over `time.rate().displayHz`. Never
 * throws.
 *
 * @param display - The header's display or a `display` event's detail (any value).
 * @returns The Hz; null when absent or not a positive finite number.
 * @example
 * ```ts
 * announcedHzOf({ ...header.display, hz: 120 }); // 120
 * announcedHzOf(header.display); // null on an engine before the display's hz
 * ```
 */
export function announcedHzOf(display: unknown): number | null {
  const hz = finiteOrNull(fieldOf(display, "hz"));
  // eslint-disable-next-line unicorn/no-null -- null is "the display announces no rate"
  return hz !== null && hz > 0 ? hz : null;
}

/**
 * A game frame event of an event line (engine fact 11): `overlay` with a numeric `entity`, a string
 * `label`, `what` among `OverlayWhat` and a string `mode`; `pool-trim` with its reason and a finite
 * `freedMb`; `warm` with finite `draws`. The editor's own `devtools`, `command`, `recorder` lines
 * and malformed details are not frame events.
 *
 * @param line - An event line.
 * @returns The frame event, or undefined.
 * @example
 * ```ts
 * frameEventOf({ v: 1, kind: "event", t: 0, build: null, frame: 4812, name: "warm", detail: { draws: 18 } });
 * // { kind: "warm", frame: 4812, draws: 18 }
 * ```
 */
export function frameEventOf(line: PerfEventLine): PerfFrameEvent | undefined {
  const { frame, detail, name } = line;
  if (!isFiniteNumber(frame)) return undefined;

  if (name === "overlay") {
    const { entity, label, what, mode } = detail;
    if (!isFiniteNumber(entity) || typeof label !== "string" || typeof mode !== "string") {
      return undefined;
    }
    return isOneOf(what, OVERLAY_WHATS) ? { kind: "overlay", frame, label, what, mode } : undefined;
  }

  if (name === "pool-trim") {
    return isPoolTrimDetail(detail)
      ? { kind: "pool-trim", frame, reason: detail.reason, freedMb: detail.freedMb }
      : undefined;
  }

  if (name === "warm" && isFiniteNumber(detail.draws)) {
    return { kind: "warm", frame, draws: detail.draws };
  }

  return undefined;
}

/**
 * Whether a value has the shape of a `RateChange` (21:117-129): numbers `from`, `to`, `dwellMs`;
 * `reason` and `mode` among their unions; `displayHz` a number or null; `window` with three numbers;
 * `thermal` a status or null.
 *
 * @param value - The detail of a `rate` event line.
 * @returns Whether it is a rate change.
 * @example
 * ```ts
 * isRateChange({ from: 120, to: 60 }); // false: reason, mode, window and dwellMs are missing
 * ```
 */
export function isRateChange(value: unknown): value is RateChange {
  const displayHz = fieldOf(value, "displayHz");
  const thermal = fieldOf(value, "thermal");
  return (
    hasNumbers(value, ["from", "to", "dwellMs"]) &&
    isOneOf(fieldOf(value, "reason"), RATE_REASONS) &&
    isOneOf(fieldOf(value, "mode"), RATE_MODES) &&
    (displayHz === null || isFiniteNumber(displayHz)) &&
    (thermal === null || isOneOf(thermal, THERMAL_STATUSES)) &&
    hasNumbers(fieldOf(value, "window"), ["drawn", "missed", "heavy"])
  );
}

/**
 * Whether a value is a string or null.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isTextOrNull(undefined); // false: a missing field is not null
 * ```
 */
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Whether a value is a finite number or null.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isNumberOrNull(Number.NaN); // false
 * ```
 */
function isNumberOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

/**
 * Whether a value is the detail of a `pool-trim` event line (spec 25 M1.8): a known reason and a
 * finite `freedMb`.
 *
 * @param value - The detail.
 * @returns Whether it is a pool trim.
 * @example
 * ```ts
 * isPoolTrimDetail({ reason: "rest", freedMb: 41.5 }); // true
 * ```
 */
export function isPoolTrimDetail(value: unknown): value is PoolTrimDetail {
  return (
    isOneOf(fieldOf(value, "reason"), TRIM_REASONS) && isFiniteNumber(fieldOf(value, "freedMb"))
  );
}

/**
 * Whether a value is the detail of a `shader` event line (E4): a string `what` (a newer engine's
 * word included), a label or null, finite `ms` and `frame`, a boolean `boot`, and the pass it ran
 * during (`pass`, `owner` numbers or null; `filter`, `view` strings or null).
 *
 * @param value - The detail.
 * @returns Whether it is a shader compile.
 * @example
 * ```ts
 * isShaderDetail({ what: "compile", label: null, ms: 3, frame: 4851, boot: false }); // false: no `during`
 * ```
 */
export function isShaderDetail(value: unknown): value is ShaderEventDetail {
  const during = fieldOf(value, "during");
  return (
    typeof fieldOf(value, "what") === "string" &&
    isTextOrNull(fieldOf(value, "label")) &&
    hasNumbers(value, ["ms", "frame"]) &&
    typeof fieldOf(value, "boot") === "boolean" &&
    isObject(during) &&
    isNumberOrNull(fieldOf(during, "pass")) &&
    isTextOrNull(fieldOf(during, "filter")) &&
    isNumberOrNull(fieldOf(during, "owner")) &&
    isTextOrNull(fieldOf(during, "view"))
  );
}

/**
 * Whether a value is the detail of a `problem` event line (N3): a string `rule` (a newer engine's
 * rule included) with an owner and a view, then either `cleared: true`, or a severity, a filter,
 * the numbers `value`, `threshold`, `since`, `frames` (each a number or null) and an optional
 * `filter-still` reason.
 *
 * @param value - The detail.
 * @returns Whether it is a problem.
 * @example
 * ```ts
 * isProblemDetail({ rule: "filter-still", cleared: true, owner: 412, view: "fogLayer" }); // true
 * ```
 */
export function isProblemDetail(value: unknown): value is ProblemEventDetail {
  if (typeof fieldOf(value, "rule") !== "string") return false;
  if (!isNumberOrNull(fieldOf(value, "owner")) || !isTextOrNull(fieldOf(value, "view"))) {
    return false;
  }
  if (fieldOf(value, "cleared") === true) return true;

  const reason = fieldOf(value, "reason");
  return (
    isOneOf(fieldOf(value, "severity"), SEVERITIES) &&
    isTextOrNull(fieldOf(value, "filter")) &&
    PROBLEM_NUMBERS.every(key => isNumberOrNull(fieldOf(value, key))) &&
    (reason === undefined || isOneOf(reason, STILL_REASONS))
  );
}

/**
 * Whether a value is the detail of a `gc` event line (N6): a finite `freedMb`, the heap after it
 * (a number or null) and a boolean `hint`.
 *
 * @param value - The detail.
 * @returns Whether it is a GC.
 * @example
 * ```ts
 * isGcDetail({ freedMb: 4.2, heapMb: 41.9, hint: true }); // true
 * ```
 */
export function isGcDetail(value: unknown): value is GcEventDetail {
  return (
    isFiniteNumber(fieldOf(value, "freedMb")) &&
    isNumberOrNull(fieldOf(value, "heapMb")) &&
    typeof fieldOf(value, "hint") === "boolean"
  );
}

/**
 * Whether a value is a list of strings.
 *
 * @param value - Any value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isNameList(["passes", 3]); // false
 * ```
 */
function isNameList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(name => typeof name === "string");
}

/**
 * Whether a value is the detail of a `sections` event line (N1): `on` and `off` lists of section
 * names. A name the editor does not know (a newer engine's section) is a string here; the reader
 * keeps the names it knows.
 *
 * @param value - The detail.
 * @returns Whether it has the shape.
 * @example
 * ```ts
 * isSectionsDetail({ on: ["passes"], off: [] }); // true
 * ```
 */
export function isSectionsDetail(
  value: unknown
): value is { readonly on: readonly string[]; readonly off: readonly string[] } {
  return isNameList(fieldOf(value, "on")) && isNameList(fieldOf(value, "off"));
}

/**
 * Whether a value is the detail of the recorder's own `recorder` event line: a known action and,
 * for a start, who started it (`by`, absent from an older recorder).
 *
 * @param value - The detail.
 * @returns Whether it is a recorder action.
 * @example
 * ```ts
 * isRecorderDetail({ action: "start", label: "boss", by: "agent", name: "Claude" }); // true
 * ```
 */
export function isRecorderDetail(value: unknown): value is {
  readonly action: "start" | "stop" | "export";
  readonly by?: string | null;
} {
  const by = fieldOf(value, "by");
  return (
    isOneOf(fieldOf(value, "action"), RECORDER_ACTIONS) && (by === undefined || isTextOrNull(by))
  );
}

/**
 * Whether a pass ring column is a typed array of exactly `capacity` cells (the 0.15.x columns are
 * pre-sized at attach, the same slot rule as `frame`).
 *
 * @param value - The column.
 * @param capacity - The pass ring's capacity.
 * @returns Whether perf can read it slot by slot.
 * @example
 * ```ts
 * isRingColumn(new Uint16Array(4096), 4096); // true
 * ```
 */
function isRingColumn(value: unknown, capacity: number): boolean {
  return ArrayBuffer.isView(value) && fieldOf(value, "length") === capacity;
}

/**
 * Whether a pass ring column is a plain array of exactly `capacity` cells (`format`).
 *
 * @param value - The column.
 * @param capacity - The pass ring's capacity.
 * @returns Whether perf can read it slot by slot.
 * @example
 * ```ts
 * isListColumn([null, "bgra8unorm"], 2); // true
 * ```
 */
function isListColumn(value: unknown, capacity: number): boolean {
  return Array.isArray(value) && value.length === capacity;
}

/**
 * The header's `measured` list, as strings (an engine after the patch lists `problems` and `gc`,
 * names the installed engine's type does not have yet); empty without a header.
 *
 * @param header - The header, or undefined.
 * @returns The list.
 * @example
 * ```ts
 * measuredOf(undefined); // []
 * ```
 */
function measuredOf(header: PerfHeaderLine | undefined): readonly unknown[] {
  const measured = fieldOf(header, "measured");
  return Array.isArray(measured) ? measured : [];
}

/**
 * How far the header's heap number can be trusted (D6): none without `heap` in `measured` (iOS,
 * WebKit), untrusted in a WebView (frozen on Android), trusted otherwise. The frozen-counter test
 * runs per sample (`memoryWhy`).
 *
 * @param header - The header, or undefined.
 * @param measured - Its `measured` list.
 * @returns The trust.
 * @example
 * ```ts
 * heapOf(header, ["gpu", "heap"]); // "untrusted" when header.device.webview is "141"
 * ```
 */
function heapOf(
  header: PerfHeaderLine | undefined,
  measured: readonly unknown[]
): PerfCaps["heap"] {
  if (!measured.includes("heap")) return "none";
  return typeof fieldOf(fieldOf(header, "device"), "webview") === "string"
    ? "untrusted"
    : "trusted";
}

/**
 * What this page's engine and build measure (spec 03 Delta 2026-10-16 D2), from the ring, the header
 * and the monitor, read structurally once per header (each column tested once with
 * `ArrayBuffer.isView` / `Array.isArray` and its length, so the read loop branches on cached
 * booleans only). `shaderEvents` is true on an engine with the pass ring's 0.15.x columns or
 * `systemNames` (the release that sends `shader` lines); a seen `shader`, `problem`, `gc` or
 * `passes` line turns its capability on later (perf's reader). Never throws; allocates its answer.
 *
 * @param ring - `monitor.frames()` (any value).
 * @param header - The newest header line, or undefined before one.
 * @param monitor - `renderer.monitor` (any value).
 * @returns The capabilities.
 * @example
 * ```ts
 * capsOf({ passes: { capacity: 4096 } }, undefined, undefined).passDraws; // false: an engine before 0.15.x
 * ```
 */
export function capsOf(
  ring: unknown,
  header: PerfHeaderLine | undefined,
  monitor: unknown
): PerfCaps {
  const passes = fieldOf(ring, "passes");
  const capacity = fieldOf(passes, "capacity");
  const slots = isFiniteNumber(capacity) ? capacity : -1;
  const passOwners =
    isRingColumn(fieldOf(passes, "owner"), slots) && isRingColumn(fieldOf(passes, "kind2"), slots);
  const systemNames = Array.isArray(fieldOf(ring, "systemNames"));
  const measured = measuredOf(header);
  return {
    passOwners,
    passDraws: isRingColumn(fieldOf(passes, "drawsAt"), slots),
    passFormat:
      isListColumn(fieldOf(passes, "format"), slots) &&
      isRingColumn(fieldOf(passes, "resolution"), slots),
    systemNames,
    shaderEvents: passOwners || systemNames,
    problems: measured.includes("problems"),
    gc: measured.includes("gc"),
    sections: typeof fieldOf(monitor, "sections") === "function",
    detail: typeof fieldOf(monitor, "detail") === "function",
    passesLine: false,
    gpuTimer: typeof fieldOf(fieldOf(header, "gpu"), "timer") === "string",
    heap: heapOf(header, measured)
  };
}
