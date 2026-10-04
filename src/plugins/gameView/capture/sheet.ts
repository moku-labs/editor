/**
 * @file gameView plugin — the contact sheet (E2): open a saved series (index.json, then every PNG
 * with readBinary, R1), step the large view, mark bugs and save index.json once per burst with
 * its version, close layer by layer for Esc.
 */
import { linkPlugin } from "../../link";
import { workspacePlugin } from "../../workspace";
import { reportFailure } from "../report";
import { notify } from "../state";
import type { GameViewCtx, SeriesIndex, SeriesShot, Sheet } from "../types";
import { folderOf } from "./naming";
import { formatIndex } from "./series";

/**
 * Debounce of the index.json save after the last bug toggle.
 */
const SHEET_SAVE_MS = 400;

/**
 * A record read from JSON.
 */
type JsonRecord = { readonly [key: string]: unknown };

/**
 * True for a plain object of a parsed JSON file.
 *
 * @param value - A parsed value.
 * @returns Whether it is a record.
 * @example
 * ```ts
 * isRecord({ a: 1 }); // true
 * ```
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one shot of an index.json; `bug` defaults to false.
 *
 * @param value - A parsed shot.
 * @returns The shot, or undefined.
 * @example
 * ```ts
 * shotEntryOf({ file: "001.png", frame: 1, atMs: 0 })?.bug; // false
 * ```
 */
function shotEntryOf(value: unknown): SeriesShot | undefined {
  if (!isRecord(value)) return undefined;
  const { file, frame, atMs, bug } = value;
  if (typeof file !== "string" || typeof frame !== "number" || typeof atMs !== "number") {
    return undefined;
  }
  return { file, frame, atMs, bug: bug === true };
}

/**
 * Reads the optional device of an index.json.
 *
 * @param value - The parsed `device` field.
 * @returns The device, or undefined.
 * @example
 * ```ts
 * indexDeviceOf({ name: "iPhone 15", w: 393, h: 852, orientation: "portrait" })?.name; // "iPhone 15"
 * ```
 */
function indexDeviceOf(value: unknown): SeriesIndex["device"] {
  if (!isRecord(value)) return undefined;
  const { name, w, h, orientation } = value;
  if (typeof name !== "string" || typeof w !== "number" || typeof h !== "number") return undefined;
  if (orientation !== "portrait" && orientation !== "landscape") return undefined;
  return { name, w, h, orientation };
}

/**
 * Reads a parsed index.json (the shape filesView reads too: `label` is optional there, so an
 * index without one takes the fallback, the series folder name).
 *
 * @param value - The parsed file (untrusted).
 * @param fallbackLabel - The label of an index that has none.
 * @returns The index, or undefined for another shape.
 * @example
 * ```ts
 * seriesIndexOf({ label: "a", durationMs: 1, intervalMs: 1, fromFrame: 0, shots: [] })?.label; // "a"
 * seriesIndexOf({ durationMs: 1, intervalMs: 1, fromFrame: 0, shots: [] }, "series-1")?.label; // "series-1"
 * ```
 */
export function seriesIndexOf(value: unknown, fallbackLabel?: string): SeriesIndex | undefined {
  if (!isRecord(value) || !Array.isArray(value.shots)) return undefined;
  const { durationMs, intervalMs, fromFrame } = value;
  const label = value.label === undefined ? fallbackLabel : value.label;
  if (
    typeof label !== "string" ||
    typeof durationMs !== "number" ||
    typeof intervalMs !== "number" ||
    typeof fromFrame !== "number"
  ) {
    return undefined;
  }
  const shots = value.shots.map(shot => shotEntryOf(shot));
  if (shots.includes(undefined)) return undefined;

  const index: SeriesIndex = {
    label,
    durationMs,
    intervalMs,
    fromFrame,
    shots: shots.filter(shot => shot !== undefined)
  };
  const device = indexDeviceOf(value.device);
  if (device !== undefined) index.device = device;
  if (value.stoppedEarly === true) index.stoppedEarly = true;
  return index;
}

/**
 * Reads one PNG of a series; a missing file is undefined (a placeholder tile).
 *
 * @param ctx - Domain context of gameView.
 * @param path - The PNG path.
 * @returns The data URL, or undefined.
 */
async function readImage(ctx: GameViewCtx, path: string): Promise<string | undefined> {
  try {
    const image = await ctx.require(linkPlugin).files.readBinary(path);
    return image.dataUrl;
  } catch {
    return;
  }
}

/**
 * Opens a saved series' contact sheet; shows Game.
 *
 * @param ctx - Domain context of gameView.
 * @param indexPath - The series' index.json.
 * @returns Resolves when the sheet is open or the failure was toasted.
 */
export async function openSheet(ctx: GameViewCtx, indexPath: string): Promise<void> {
  ctx.require(workspacePlugin).show("game");
  try {
    const file = await ctx.require(linkPlugin).files.read(indexPath);
    const parsed: unknown = JSON.parse(file.text);
    const index = seriesIndexOf(parsed, folderOf(indexPath).split("/").at(-2));
    if (index === undefined) {
      throw new Error(
        `[moku-editor] ${indexPath} is not a series index.\n  Open a series folder's index.json.`
      );
    }
    const folder = folderOf(indexPath);
    const images = await Promise.all(
      index.shots.map(shot => readImage(ctx, `${folder}${shot.file}`))
    );
    ctx.state.series.sheet = { indexPath, index, images, version: file.version, big: undefined };
    notify(ctx.state);
  } catch (error) {
    reportFailure(ctx, "Contact sheet not readable", "gameView: sheet failed", error);
  }
}

/**
 * Opens the large view on one shot.
 *
 * @param ctx - Domain context of gameView.
 * @param shot - The shot index.
 */
export function showShot(ctx: Pick<GameViewCtx, "state">, shot: number): void {
  const { sheet } = ctx.state.series;
  if (sheet === undefined || sheet.index.shots[shot] === undefined) return;
  sheet.big = shot;
  notify(ctx.state);
}

/**
 * Steps the large view (← →), clamped at the ends; the first step opens it.
 *
 * @param ctx - Domain context of gameView.
 * @param direction - 1 next, -1 back.
 */
export function stepSheet(ctx: Pick<GameViewCtx, "state">, direction: 1 | -1): void {
  const { sheet } = ctx.state.series;
  const count = sheet?.index.shots.length ?? 0;
  if (sheet === undefined || count === 0) return;

  if (sheet.big === undefined) {
    sheet.big = direction === 1 ? 0 : count - 1;
  } else {
    sheet.big = Math.min(count - 1, Math.max(0, sheet.big + direction));
  }
  notify(ctx.state);
}

/**
 * Saves index.json of a sheet with its version (the debounced end of a bug burst).
 *
 * @param ctx - Domain context of gameView.
 * @param sheet - The sheet.
 * @returns Resolves when saved or the failure was toasted.
 */
async function saveSheet(ctx: GameViewCtx, sheet: Sheet): Promise<void> {
  clearTimeout(ctx.state.timers.sheetSave);
  delete ctx.state.timers.sheetSave;
  try {
    const written = await ctx
      .require(linkPlugin)
      .files.write(sheet.indexPath, formatIndex(sheet.index), sheet.version);
    sheet.version = written.version;
    ctx.require(workspacePlugin).toast("✓ Saved", sheet.indexPath);
  } catch (error) {
    reportFailure(ctx, "Save failed", "gameView: sheet save failed", error);
  }
}

/**
 * Flips the bug mark of a shot; index.json is saved 400 ms after the last toggle.
 *
 * @param ctx - Domain context of gameView.
 * @param shot - The shot index.
 */
export function toggleBug(ctx: GameViewCtx, shot: number): void {
  const { state } = ctx;
  const { sheet } = state.series;
  const entry = sheet?.index.shots[shot];
  if (sheet === undefined || entry === undefined) return;

  entry.bug = !entry.bug;
  notify(state);
  clearTimeout(state.timers.sheetSave);
  state.timers.sheetSave = setTimeout(() => {
    void saveSheet(ctx, sheet);
  }, SHEET_SAVE_MS);
}

/**
 * Esc on the contact sheet: closes the large view first, then the sheet (saving pending marks).
 *
 * @param ctx - Domain context of gameView.
 * @returns True when something closed.
 */
export function closeSheetLayer(ctx: GameViewCtx): boolean {
  const { state } = ctx;
  const { sheet } = state.series;
  if (sheet === undefined) return false;

  if (sheet.big === undefined) {
    if (state.timers.sheetSave !== undefined) void saveSheet(ctx, sheet);
    state.series.sheet = undefined;
  } else {
    sheet.big = undefined;
  }
  notify(state);
  return true;
}
