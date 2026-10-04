/**
 * @file workspace plugin — the per-viewer preferences record in localStorage:
 * `{ v: 1, theme?, previews, device: { preset, orientation, folded? }, density, showTaps, muted }`.
 * Invalid JSON, another version or a throwing storage → the defaults; an unknown value → the
 * default of that value; one `workspace:prefs` warn either way. A field added after the first
 * records (density, showTaps, muted, device.folded) that is missing takes its default silently.
 * Writes are wrapped in try/catch (quota). Nothing essential is stored here.
 */
import type { Log } from "@moku-labs/common/browser";
import { DEFAULT_DEVICE, isDevicePresetId } from "../../registry/protocol";
import { defaultPreview, defaultPreviews } from "../state";
import type {
  Orientation,
  PreviewCorner,
  PreviewPrefs,
  PreviewSize,
  StoredPrefs,
  Theme
} from "../types";
import { PREVIEW_WORKSPACES } from "../workspaces";
import { isDensityChoice } from "./density";

/**
 * Version of the stored record.
 */
const VERSION = 1;

/**
 * The log event of every preferences problem.
 */
const PREFS_EVENT = "workspace:prefs";

/**
 * A parsed JSON object (the record and its nested objects).
 */
type JsonObject = { readonly [key: string]: unknown };

/**
 * The preferences of a fresh viewer.
 *
 * @returns No chosen theme, default previews, iPhone 18 Pro portrait, auto density, taps shown,
 * sound on.
 * @example
 * ```ts
 * defaultStoredPrefs().device; // { preset: "iphone-18-pro", orientation: "portrait" }
 * ```
 */
export function defaultStoredPrefs(): StoredPrefs {
  return {
    theme: undefined,
    previews: defaultPreviews(),
    device: { preset: DEFAULT_DEVICE, orientation: "portrait" },
    density: "auto",
    showTaps: true,
    muted: false
  };
}

/**
 * True for a plain object (not an array, not null).
 *
 * @param value - A parsed JSON value.
 * @returns Whether it is an object record.
 * @example
 * ```ts
 * isObject(JSON.parse("{}")); // true
 * ```
 */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for "light" or "dark".
 *
 * @param value - A parsed value.
 * @returns Whether it is a Theme.
 * @example
 * ```ts
 * isTheme("dark"); // true
 * ```
 */
function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * True for "S", "M" or "L".
 *
 * @param value - A parsed value.
 * @returns Whether it is a PreviewSize.
 * @example
 * ```ts
 * isSize("M"); // true
 * ```
 */
function isSize(value: unknown): value is PreviewSize {
  return value === "S" || value === "M" || value === "L";
}

/**
 * True for one of the four corners.
 *
 * @param value - A parsed value.
 * @returns Whether it is a PreviewCorner.
 * @example
 * ```ts
 * isCorner("top-left"); // true
 * ```
 */
function isCorner(value: unknown): value is PreviewCorner {
  return (
    value === "top-left" ||
    value === "top-right" ||
    value === "bottom-left" ||
    value === "bottom-right"
  );
}

/**
 * True for "portrait" or "landscape".
 *
 * @param value - A parsed value.
 * @returns Whether it is an Orientation.
 * @example
 * ```ts
 * isOrientation("landscape"); // true
 * ```
 */
function isOrientation(value: unknown): value is Orientation {
  return value === "portrait" || value === "landscape";
}

/**
 * Reads one stored preview record.
 *
 * @param value - The stored value.
 * @returns The prefs, undefined when any field is unknown.
 * @example
 * ```ts
 * readPreview({ visible: false, size: "M", corner: "top-left" });
 * ```
 */
function readPreview(value: unknown): PreviewPrefs | undefined {
  if (!isObject(value)) return undefined;
  const { visible, size, corner } = value;
  if (typeof visible !== "boolean" || !isSize(size) || !isCorner(corner)) return undefined;
  return { visible, size, corner };
}

/**
 * Reads the stored preview of every workspace into the prefs; unknown ones take the default.
 *
 * @param previews - The stored previews object.
 * @param prefs - The preferences being built.
 * @param invalid - Collects the paths of unknown values.
 * @example
 * ```ts
 * readPreviews({ flow: { visible: false, size: "M", corner: "top-left" } }, prefs, invalid);
 * ```
 */
function readPreviews(previews: JsonObject, prefs: StoredPrefs, invalid: string[]): void {
  for (const ws of PREVIEW_WORKSPACES) {
    if (previews[ws] === undefined) continue;
    const preview = readPreview(previews[ws]);
    if (preview === undefined) invalid.push(`previews.${ws}`);
    prefs.previews[ws] = preview ?? defaultPreview();
  }
}

/**
 * Reads the stored device into the prefs; an unknown preset or orientation takes the default, a
 * folded flag that is not a boolean is dropped.
 *
 * @param device - The stored device value.
 * @param prefs - The preferences being built.
 * @param invalid - Collects the paths of unknown values.
 * @example
 * ```ts
 * readDevice({ preset: "pixel-8", orientation: "landscape" }, prefs, invalid);
 * ```
 */
function readDevice(device: unknown, prefs: StoredPrefs, invalid: string[]): void {
  const stored = isObject(device) ? device : {};
  if (isDevicePresetId(stored.preset)) prefs.device.preset = stored.preset;
  else invalid.push("device.preset");
  if (isOrientation(stored.orientation)) prefs.device.orientation = stored.orientation;
  else invalid.push("device.orientation");
  if (typeof stored.folded === "boolean") prefs.device.folded = stored.folded;
  else if (stored.folded !== undefined) invalid.push("device.folded");
}

/**
 * Reads an on/off field added after the first records: a missing value is the default, silently;
 * a value that is not a boolean is the default too, and its name goes into `invalid`.
 *
 * @param value - The stored value.
 * @param field - The field name.
 * @param fallback - The default.
 * @param invalid - Collects the paths of unknown values.
 * @returns The stored flag, or the default.
 * @example
 * ```ts
 * readFlag(undefined, "muted", false, invalid); // false, nothing collected
 * ```
 */
function readFlag(
  value: unknown,
  field: "showTaps" | "muted",
  fallback: boolean,
  invalid: string[]
): boolean {
  if (typeof value === "boolean") return value;
  if (value !== undefined) invalid.push(field);
  return fallback;
}

/**
 * Reads a version-1 record field by field; every unknown value takes its default and its path
 * goes into `invalid`.
 *
 * @param record - The parsed record (v already checked).
 * @param invalid - Collects the paths of unknown values.
 * @returns The preferences.
 * @example
 * ```ts
 * const invalid: string[] = [];
 * readRecord({ v: 1, theme: "dark" }, invalid);
 * ```
 */
function readRecord(record: JsonObject, invalid: string[]): StoredPrefs {
  const prefs = defaultStoredPrefs();

  if (isTheme(record.theme)) prefs.theme = record.theme;
  else if (record.theme !== undefined) invalid.push("theme");

  if (isObject(record.previews)) readPreviews(record.previews, prefs, invalid);
  else invalid.push("previews");
  readDevice(record.device, prefs, invalid);

  // Added after the first records: a missing value is the default, silently.
  if (isDensityChoice(record.density)) prefs.density = record.density;
  else if (record.density !== undefined) invalid.push("density");
  prefs.showTaps = readFlag(record.showTaps, "showTaps", prefs.showTaps, invalid);
  prefs.muted = readFlag(record.muted, "muted", prefs.muted, invalid);

  return prefs;
}

/**
 * The message of anything thrown.
 *
 * @param error - A caught value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("quota")); // "quota"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the preferences. A missing record or a missing `localStorage` gives the defaults
 * silently; a broken one gives defaults and one `workspace:prefs` warn.
 *
 * @param key - The localStorage key (config.storageKey).
 * @param log - Where the one warn goes.
 * @returns The preferences.
 */
export function loadPrefs(key: string, log: Log.LogApi): StoredPrefs {
  const storage: Storage | undefined = globalThis.localStorage;
  if (storage === undefined) return defaultStoredPrefs();

  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch (error) {
    log.warn(PREFS_EVENT, { op: "load", message: messageOf(error) });
    return defaultStoredPrefs();
  }
  if (text === null) return defaultStoredPrefs();

  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (error) {
    log.warn(PREFS_EVENT, { op: "parse", message: messageOf(error) });
    return defaultStoredPrefs();
  }
  if (!isObject(record) || record.v !== VERSION) {
    log.warn(PREFS_EVENT, { op: "version", message: "not a version 1 record" });
    return defaultStoredPrefs();
  }

  const invalid: string[] = [];
  const prefs = readRecord(record, invalid);
  if (invalid.length > 0) log.warn(PREFS_EVENT, { invalid });
  return prefs;
}

/**
 * Saves the preferences; a full or throwing storage is one warn, never an error.
 *
 * @param key - The localStorage key (config.storageKey).
 * @param prefs - The preferences to store.
 * @param log - Where a failed write is reported.
 * @example
 * ```ts
 * savePrefs("moku-editor", defaultStoredPrefs(), log); // localStorage["moku-editor"] holds the record
 * ```
 */
export function savePrefs(key: string, prefs: StoredPrefs, log: Log.LogApi): void {
  const storage: Storage | undefined = globalThis.localStorage;
  if (storage === undefined) return;

  const record = {
    v: VERSION,
    theme: prefs.theme,
    previews: prefs.previews,
    device: prefs.device,
    density: prefs.density,
    showTaps: prefs.showTaps,
    muted: prefs.muted
  };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch (error) {
    log.warn(PREFS_EVENT, { op: "save", message: messageOf(error) });
  }
}
