/**
 * @file workspace plugin — the per-viewer preferences record in localStorage:
 * `{ v: 1, theme?, previews, device }`. Invalid JSON, another version or a throwing storage →
 * the defaults; an unknown value → the default of that value; one `workspace:prefs` warn either
 * way. Writes are wrapped in try/catch (quota). Nothing essential is stored here.
 */
import type { Log } from "@moku-labs/common/browser";
import { DEFAULT_DEVICE, isDevicePresetId } from "../devices";
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
 * @returns No chosen theme, default previews, iPhone 15 portrait.
 * @example
 * ```ts
 * defaultStoredPrefs().device; // { preset: "iphone-15", orientation: "portrait" }
 * ```
 */
export function defaultStoredPrefs(): StoredPrefs {
  return {
    theme: undefined,
    previews: defaultPreviews(),
    device: { preset: DEFAULT_DEVICE, orientation: "portrait" }
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

  const { previews, device } = record;
  if (isObject(previews)) readPreviews(previews, prefs, invalid);
  else invalid.push("previews");

  const stored = isObject(device) ? device : {};
  if (isDevicePresetId(stored.preset)) prefs.device.preset = stored.preset;
  else invalid.push("device.preset");
  if (isOrientation(stored.orientation)) prefs.device.orientation = stored.orientation;
  else invalid.push("device.orientation");

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

  const record = { v: VERSION, theme: prefs.theme, previews: prefs.previews, device: prefs.device };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch (error) {
    log.warn(PREFS_EVENT, { op: "save", message: messageOf(error) });
  }
}
