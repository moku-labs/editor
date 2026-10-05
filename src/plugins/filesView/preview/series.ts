/**
 * @file filesView plugin — the series `index.json` gameView writes (13-gameView `SeriesIndex`, a
 * shape, not a module import): the path rule, a strict reader and the card summary.
 */
import type { Json } from "../../registry/protocol";
import type { SeriesIndex } from "../types";

/**
 * Where gameView writes series folders: in a day folder (`<yyyy-mm-dd>/series-<hhmm>/`, captures
 * by day) or, for series taken before day folders, flat under the captures folder.
 */
const SERIES_INDEX_PATH = /^\.moku\/captures\/(?:\d{4}-\d{2}-\d{2}\/)?series-[^/]+\/index\.json$/;

/**
 * A plain JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/**
 * One shot of a series.
 */
type Shot = SeriesIndex["shots"][number];

/**
 * True for a JSON object (not null, not an array).
 *
 * @param value - A JSON value.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject({ a: 1 }); // true
 * ```
 */
function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a finite number.
 *
 * @param value - A JSON value.
 * @returns Whether it is a finite number.
 * @example
 * ```ts
 * isNumber(250); // true
 * ```
 */
function isNumber(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Reads one shot; a wrong type anywhere gives undefined.
 *
 * @param value - The JSON of a shot.
 * @returns The shot, or undefined.
 * @example
 * ```ts
 * shotOf({ file: "shot-01.png", frame: 1841, atMs: 0 }); // the same shot
 * ```
 */
function shotOf(value: Json): Shot | undefined {
  if (!isObject(value)) return undefined;
  const { file, frame, atMs, bug } = value;
  if (typeof file !== "string" || !isNumber(frame) || !isNumber(atMs)) return undefined;
  if (bug !== undefined && typeof bug !== "boolean") return undefined;
  return bug === undefined ? { file, frame, atMs } : { file, frame, atMs, bug };
}

/**
 * Reads the optional fields; a wrong type gives undefined.
 *
 * @param value - The parsed index.
 * @returns The optional part, or undefined when a field has the wrong type.
 * @example
 * ```ts
 * optionalOf({ label: "burst" }); // { label: "burst" }
 * ```
 */
function optionalOf(value: JsonObject): Partial<SeriesIndex> | undefined {
  const { label, device, stoppedEarly } = value;
  if (label !== undefined && typeof label !== "string") return undefined;
  if (stoppedEarly !== undefined && typeof stoppedEarly !== "boolean") return undefined;
  return {
    ...(label === undefined ? {} : { label }),
    ...(device === undefined ? {} : { device }),
    ...(stoppedEarly === undefined ? {} : { stoppedEarly })
  };
}

/**
 * True for the index.json of a series folder.
 *
 * @param path - A relative path.
 * @returns Whether the path is `.moku/captures/[<yyyy-mm-dd>/]series-<name>/index.json`.
 * @example
 * ```ts
 * isSeriesIndexPath(".moku/captures/2026-10-05/series-1015/index.json"); // true
 * ```
 */
export function isSeriesIndexPath(path: string): boolean {
  return SERIES_INDEX_PATH.test(path);
}

/**
 * Reads a series index; unknown fields are ignored, a wrong type anywhere gives undefined.
 *
 * @param text - The file text.
 * @returns The index, or undefined.
 * @example
 * ```ts
 * parseSeriesIndex('{ "durationMs": 3000, "intervalMs": 250, "fromFrame": 1841, "shots": [] }')?.intervalMs; // 250
 * ```
 */
export function parseSeriesIndex(text: string): SeriesIndex | undefined {
  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;

  const { durationMs, intervalMs, fromFrame, shots } = parsed;
  if (!isNumber(durationMs) || !isNumber(intervalMs) || !isNumber(fromFrame)) return undefined;
  if (!Array.isArray(shots)) return undefined;

  const read = shots.map(shot => shotOf(shot));
  const optional = optionalOf(parsed);
  if (optional === undefined || read.includes(undefined)) return undefined;

  return {
    ...optional,
    durationMs,
    intervalMs,
    fromFrame,
    shots: read.filter(shot => shot !== undefined)
  };
}

/**
 * The card line: "Series · <label> · N shots · D s at I ms · from frame F" (+ "stopped early");
 * the folder name stands in for a missing label.
 *
 * @param index - The series index.
 * @param path - Its path.
 * @returns The summary.
 * @example
 * ```ts
 * seriesSummary({ durationMs: 3000, intervalMs: 250, fromFrame: 1841, shots: [] }, ".moku/captures/burst/index.json");
 * // "Series · burst · 0 shots · 3 s at 250 ms · from frame 1841"
 * ```
 */
export function seriesSummary(index: SeriesIndex, path: string): string {
  const folder = path.split("/").at(-2) ?? path;
  const shots = index.shots.length;
  const seconds = Number((index.durationMs / 1000).toFixed(2));
  const parts = [
    "Series",
    index.label ?? folder,
    `${shots} ${shots === 1 ? "shot" : "shots"}`,
    `${seconds} s at ${index.intervalMs} ms`,
    `from frame ${index.fromFrame}`
  ];
  if (index.stoppedEarly === true) parts.push("stopped early");
  return parts.join(" · ");
}
