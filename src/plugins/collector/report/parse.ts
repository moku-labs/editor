/**
 * @file collector/report — `parsePerfLog`: one pass over a `.jsonl` file into the lines the report
 * reads; every other line is counted by reason, never misread. Unknown fields stay untouched.
 * `isPerfLog` tells a moku perf log (v1) from any other file. Pure.
 */
import type {
  OverlayWhat,
  PerfCollectorLine,
  PerfEventLine,
  PerfHeaderLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfThermalLine
} from "../../perf/protocol";
import { PERF_GAP_BUCKETS, PERF_LOG_VERSION } from "../../perf/protocol";
import type { ParsedLog, SkippedLines } from "./types";

/** A decoded JSON object of a line, before its kind is checked. */
type LineObject = { readonly [key: string]: unknown };

/** What the pass collects while it runs. */
type Collected = {
  header: PerfHeaderLine | undefined;
  samples: PerfSampleLine[];
  spikes: PerfSpikeLine[];
  marks: PerfMarkLine[];
  rates: PerfEventLine[];
  frameEvents: PerfEventLine[];
  thermal: PerfThermalLine[];
  gfx: PerfCollectorLine[];
  lost: number;
  lines: number;
  skipped: { -readonly [K in keyof SkippedLines]: number };
};

/** The kinds of a v1 log, the editor's `gap` included (11-monitor R11.2). */
const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "header",
  "startup",
  "sample",
  "spike",
  "longFrame",
  "event",
  "mark",
  "thermal",
  "gfx",
  "gap"
]);

/** What a game overlay did (spec 22 O10.2). */
const OVERLAY_WHATS: ReadonlySet<string> = new Set([
  "open",
  "landed",
  "leave",
  "gone",
  "live",
  "kept"
]);

/**
 * Whether a value is a plain JSON object (not null, not an array).
 *
 * @param value - A decoded value.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject([1]); // false
 * ```
 */
function isObject(value: unknown): value is LineObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a finite number.
 *
 * @param value - A decoded value.
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
 * Whether a value names what a game overlay did.
 *
 * @param value - A decoded value.
 * @returns Whether it is an OverlayWhat.
 * @example
 * ```ts
 * isOverlayWhat("exiting"); // false
 * ```
 */
export function isOverlayWhat(value: unknown): value is OverlayWhat {
  return typeof value === "string" && OVERLAY_WHATS.has(value);
}

/**
 * The minimal check of a sample: a finite `t`, a string `path`, a numeric `windowMs` and a
 * `frameHist` of PERF_GAP_BUCKETS non-negative whole numbers.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isSample({ t: 1, path: "a", windowMs: 1000, frameHist: [] }); // false
 * ```
 */
function isSample(line: LineObject): line is LineObject & PerfSampleLine {
  const { frameHist } = line;
  return (
    isFiniteNumber(line.t) &&
    typeof line.path === "string" &&
    isFiniteNumber(line.windowMs) &&
    Array.isArray(frameHist) &&
    frameHist.length === PERF_GAP_BUCKETS &&
    frameHist.every(count => Number.isInteger(count) && count >= 0)
  );
}

/**
 * The minimal check of a spike: a finite `t` and a `frame` with a string `path`, a `causes` list
 * and a numeric `rateMs`.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isSpike({ t: 1, frame: { path: "a", causes: [] } }); // false
 * ```
 */
function isSpike(line: LineObject): line is LineObject & PerfSpikeLine {
  const { frame } = line;
  return (
    isFiniteNumber(line.t) &&
    isObject(frame) &&
    typeof frame.path === "string" &&
    Array.isArray(frame.causes) &&
    isFiniteNumber(frame.rateMs)
  );
}

/**
 * The minimal check of a mark: a finite `t` and a string `label`.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isMark({ t: 1, label: "boss", auto: false }); // true
 * ```
 */
function isMark(line: LineObject): line is LineObject & PerfMarkLine {
  return isFiniteNumber(line.t) && typeof line.label === "string";
}

/**
 * The minimal check of a thermal line: a finite `t` and a string or null `device`.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isThermal({ t: 1, device: 42 }); // false
 * ```
 */
function isThermal(line: LineObject): line is LineObject & PerfThermalLine {
  return isFiniteNumber(line.t) && (typeof line.device === "string" || line.device === null);
}

/**
 * The minimal check of a gfx line: a finite `t`, a string or null `device`, numeric `seconds`,
 * `frames`, `janky` and a `hist` object.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isGfx({ t: 1, device: "X", seconds: 10, frames: 600, janky: 6, hist: {} }); // true
 * ```
 */
function isGfx(line: LineObject): line is LineObject & PerfCollectorLine {
  return (
    isThermal(line) &&
    isFiniteNumber(line.seconds) &&
    isFiniteNumber(line.frames) &&
    isFiniteNumber(line.janky) &&
    isObject(line.hist)
  );
}

/**
 * The minimal check of an event line: a finite `t`, a string `name` and a `detail` object.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isEvent({ t: 1, name: "scene", detail: {} }); // true
 * ```
 */
function isEvent(line: LineObject): line is LineObject & PerfEventLine {
  return isFiniteNumber(line.t) && typeof line.name === "string" && isObject(line.detail);
}

/**
 * The minimal check of a header: a finite `t`. Its other fields are read defensively.
 *
 * @param line - The line.
 * @returns Whether the report can read it.
 * @example
 * ```ts
 * isHeader({ t: 0, engine: null }); // true
 * ```
 */
function isHeader(line: LineObject): line is LineObject & PerfHeaderLine {
  return isFiniteNumber(line.t);
}

/**
 * Keeps a line in a list when it passes its check.
 *
 * @param list - The list.
 * @param line - The line.
 * @param check - The minimal check of its kind.
 * @returns Whether it was kept (false: badShape).
 */
function keep<Line>(
  list: Line[],
  line: LineObject,
  check: (line: LineObject) => line is LineObject & Line
): boolean {
  if (!check(line)) return false;

  list.push(line);
  return true;
}

/**
 * Pushes a checked line when its detail passed.
 *
 * @param passed - Whether the detail passed its check.
 * @param list - The list.
 * @param line - The line.
 * @returns `passed` (false: badShape).
 */
function keepIf<Line>(passed: boolean, list: Line[], line: Line): boolean {
  if (passed) list.push(line);
  return passed;
}

/**
 * The check of a frame event's detail: `overlay` a string `label` and a `what` among
 * OverlayWhat, `pool-trim` a numeric `freedMb`, `warm` a numeric `draws`.
 *
 * @param name - The event name.
 * @param detail - Its detail.
 * @returns Whether the detail passed.
 * @example
 * ```ts
 * isFrameDetail("warm", { draws: 12 }); // true
 * ```
 */
function isFrameDetail(name: string, detail: PerfEventLine["detail"]): boolean {
  if (name === "overlay") return typeof detail.label === "string" && isOverlayWhat(detail.what);
  if (name === "pool-trim") return isFiniteNumber(detail.freedMb);

  return isFiniteNumber(detail.draws);
}

/** The game's frame events the report keeps (addendum 3B/4 item 1). */
const FRAME_EVENTS: ReadonlySet<string> = new Set(["overlay", "pool-trim", "warm"]);

/**
 * Sorts an event line: `rate` into rates, the game's `overlay`, `pool-trim` and `warm` into the
 * frame events, each after the check of its detail; any other name (`devtools`, `command`, …) is
 * read and not kept.
 *
 * @param line - The line.
 * @param into - What the pass collects.
 * @returns Whether the line was well formed (false: badShape).
 */
function keepEvent(line: LineObject, into: Collected): boolean {
  if (!isEvent(line)) return false;

  const { name, detail } = line;
  if (name === "rate") {
    return keepIf(isFiniteNumber(detail.from) && isFiniteNumber(detail.to), into.rates, line);
  }
  if (!FRAME_EVENTS.has(name)) return true;

  return keepIf(isFrameDetail(name, detail), into.frameEvents, line);
}

/**
 * Reads a line of a known kind into the collection.
 *
 * @param line - The line (v1, known kind).
 * @param kind - Its kind.
 * @param into - What the pass collects.
 * @returns Whether it was well formed (false: badShape).
 */
function keepLine(line: LineObject, kind: string, into: Collected): boolean {
  switch (kind) {
    case "header": {
      if (!isHeader(line)) return false;
      into.header ??= line;
      return true;
    }
    case "sample": {
      return keep(into.samples, line, isSample);
    }
    case "spike": {
      return keep(into.spikes, line, isSpike);
    }
    case "mark": {
      return keep(into.marks, line, isMark);
    }
    case "thermal": {
      return keep(into.thermal, line, isThermal);
    }
    case "gfx": {
      return keep(into.gfx, line, isGfx);
    }
    case "event": {
      return keepEvent(line, into);
    }
    case "gap": {
      if (!isFiniteNumber(line.lines) || line.lines < 0) return false;
      into.lost += line.lines;
      return true;
    }
    default: {
      return true;
    }
  }
}

/**
 * Reads one non-empty line of the file: JSON, a version, a known kind, then its check.
 *
 * @param raw - The line.
 * @param into - What the pass collects.
 */
function readRaw(raw: string, into: Collected): void {
  const { skipped } = into;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    skipped.notJson += 1;
    return;
  }

  if (!isObject(value) || typeof value.v !== "number") skipped.noVersion += 1;
  else if (value.v !== PERF_LOG_VERSION) skipped.otherVersion += 1;
  else if (typeof value.kind !== "string" || !KNOWN_KINDS.has(value.kind)) skipped.unknownKind += 1;
  else if (!keepLine(value, value.kind, into)) skipped.badShape += 1;
}

/**
 * Parses a PerfLogLine v1 file in one pass. An empty line is ignored; a line that is not JSON (a
 * log cut in the middle of a write) counts `notJson`; no numeric `v` (the game's old log)
 * `noVersion`; another version `otherVersion`; an unknown kind `unknownKind`; a known kind that
 * fails its minimal check `badShape`. `overlay`, `pool-trim` and `warm` event lines go to
 * `frameEvents`, `rate` lines to `rates`; other event lines are read and not kept.
 *
 * @param text - The file's text.
 * @returns What it read.
 * @example
 * ```ts
 * parsePerfLog('{"v":1,"kind":"mark","t":5,"build":null,"label":"boss","auto":false}\n{"v":2}').skipped.otherVersion; // 1
 * ```
 */
export function parsePerfLog(text: string): ParsedLog {
  const into: Collected = {
    header: undefined,
    samples: [],
    spikes: [],
    marks: [],
    rates: [],
    frameEvents: [],
    thermal: [],
    gfx: [],
    lost: 0,
    lines: 0,
    skipped: { notJson: 0, noVersion: 0, otherVersion: 0, unknownKind: 0, badShape: 0 }
  };

  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;

    into.lines += 1;
    readRaw(raw, into);
  }

  const { header, ...rest } = into;
  // eslint-disable-next-line unicorn/no-null -- null is "no header" on ParsedLog
  return { ...rest, header: header ?? null };
}

/**
 * Whether a parsed file is a moku perf log (v1): at least one header or sample. pages refuses
 * any other file ("not a moku perf log (v1)").
 *
 * @param log - What parsePerfLog read.
 * @returns Whether it is a perf log.
 * @example
 * ```ts
 * isPerfLog(parsePerfLog('{"t":1,"kind":"mark","label":"ward"}')); // false
 * ```
 */
export function isPerfLog(log: ParsedLog): boolean {
  return log.header !== null || log.samples.length > 0;
}
