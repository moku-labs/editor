/**
 * @file perf/protocol — the guards perf reads the engine through: the monitor and the render stats
 * of a game, the off reason, and the shapes of the event details it keeps (`display`, `rate`, the
 * game's frame events). Every guard reads structurally and never throws: a getter that throws counts
 * as a missing field. Runtime-free.
 */
import type {
  MonitorLike,
  OverlayWhat,
  PerfDisplay,
  PerfEventLine,
  PoolTrimDetail,
  RateChange,
  RateMode,
  RateReason,
  ThermalStatus
} from "./engine";
import type { PerfFrameEvent, PerfOffReason, PerfRenderStats } from "./values";

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
    const { reason, freedMb } = detail;
    if (!isOneOf(reason, TRIM_REASONS) || !isFiniteNumber(freedMb)) return undefined;
    return { kind: "pool-trim", frame, reason, freedMb };
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
