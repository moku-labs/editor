/**
 * @file gameView plugin — capture names (pure): the day folder every capture goes into
 * (`<capturesDir>/<yyyy-mm-dd>`, captures-by-day), the local minute stamp, the extension of a
 * picture (D-34), screenshot paths, the two files, the card file (round 2b R13) and the bookmark id
 * of a pick, the folder of a card, and series folders with `-2`, `-3` … on a collision,
 * zero-padded shot names, and small readers of the values a capture needs (game.position, folder
 * of a path).
 */
import type { FileEntry, Json } from "../../registry/protocol";

/**
 * What a capture needs of a game.position value.
 */
export type PositionInfo = {
  readonly path?: string;
  readonly flow?: string;
  readonly node?: string;
};

/**
 * The file extensions of a pick's two pictures (A19): the crop and the full frame.
 */
export type PickExtensions = { readonly crop: string; readonly full: string };

/**
 * Characters a file name keeps; every other run becomes "-".
 */
const UNSAFE_NAME = /[^\w-]+/g;

/**
 * The media subtype of an image data URL: `jpeg` of `data:image/jpeg;base64,…`.
 */
const IMAGE_TYPE = /^data:image\/([\w.+-]+)[;,]/;

/**
 * The fewest digits of a shot name: `001.png`.
 */
const MIN_SHOT_DIGITS = 3;

/**
 * Pads a number to two digits.
 *
 * @param value - 0–99.
 * @returns "07", "12".
 * @example
 * ```ts
 * two(7); // "07"
 * ```
 */
function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The local hour and minute as `hhmm`: a capture's name inside its day folder.
 *
 * @param date - The moment.
 * @returns The stamp.
 * @example
 * ```ts
 * stamp(new Date(2026, 9, 5, 8, 46)); // "0846"
 * ```
 */
export function stamp(date: Date): string {
  return `${two(date.getHours())}${two(date.getMinutes())}`;
}

/**
 * The day folder of a capture: `<capturesDir>/<yyyy-mm-dd>` of the local date, the same clock as
 * `stamp`. Every capture writer names its files inside it.
 *
 * @param capturesDir - The captures folder.
 * @param date - The moment of the capture.
 * @returns The folder, without a trailing slash.
 * @example
 * ```ts
 * dayFolder(".moku/captures", new Date(2026, 9, 5, 8, 46)); // ".moku/captures/2026-10-05"
 * ```
 */
export function dayFolder(capturesDir: string, date: Date): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${capturesDir}/${day}`;
}

/**
 * The folder of a reference card: the folder of its pick's full frame, so the card's
 * `![frame](…)` links find the pictures even when the pick was taken on another day; the day
 * folder of `date` without one.
 *
 * @param capturesDir - The captures folder.
 * @param full - The full frame of the pick, undefined without one.
 * @param date - The moment of the card.
 * @returns The folder, without a trailing slash.
 * @example
 * ```ts
 * cardFolder(".moku/captures", ".moku/captures/2026-10-04/f12-full.jpg", new Date(2026, 9, 5)); // ".moku/captures/2026-10-04"
 * cardFolder(".moku/captures", undefined, new Date(2026, 9, 5)); // ".moku/captures/2026-10-05"
 * ```
 */
export function cardFolder(capturesDir: string, full: string | undefined, date: Date): string {
  return full === undefined ? dayFolder(capturesDir, date) : folderOf(full).slice(0, -1);
}

/**
 * The first free name of `base`, `base-2`, `base-3` … with a suffix.
 *
 * @param base - The name without suffix.
 * @param suffix - ".png", "-crop.jpg" or "".
 * @param taken - Paths already present.
 * @returns The free name.
 * @example
 * ```ts
 * firstFree("a/b", ".png", new Set(["a/b.png"])); // "a/b-2.png"
 * ```
 */
function firstFree(base: string, suffix: string, taken: ReadonlySet<string>): string {
  if (!taken.has(`${base}${suffix}`)) return `${base}${suffix}`;

  let count = 2;
  while (taken.has(`${base}-${count}${suffix}`)) count += 1;
  return `${base}-${count}${suffix}`;
}

/**
 * The file extension of a picture, so its bytes and its name match (D-34): `jpg` for a JPEG data
 * URL, the subtype for another image, `png` for anything else.
 *
 * @param image - The data URL of the picture.
 * @returns "jpg", "png", "webp" …
 * @example
 * ```ts
 * imageExtension("data:image/jpeg;base64,/9j/"); // "jpg"
 * ```
 */
export function imageExtension(image: string): string {
  const subtype = IMAGE_TYPE.exec(image)?.[1];
  if (subtype === undefined) return "png";
  return subtype === "jpeg" ? "jpg" : subtype;
}

/**
 * The screenshot path `<dir>/<stamp>-<node>.<extension>`, with `-2`, `-3` … when taken.
 *
 * @param capturesDir - The day folder (`dayFolder`).
 * @param minute - The stamp.
 * @param node - The node name (unsafe characters become "-").
 * @param taken - Paths already in the folder.
 * @param extension - The extension of the picture (`imageExtension`); "png" by default.
 * @returns The path.
 * @example
 * ```ts
 * capturePath(".moku/captures/2026-10-05", "0846", "board", new Set(), "jpg"); // ".moku/captures/2026-10-05/0846-board.jpg"
 * ```
 */
export function capturePath(
  capturesDir: string,
  minute: string,
  node: string,
  taken: ReadonlySet<string>,
  extension = "png"
): string {
  return firstFree(`${capturesDir}/${minute}-${safeName(node)}`, `.${extension}`, taken);
}

/**
 * The two files of a pick (A19): the crop `<dir>/<name>-f<frame>-crop.<ext>` and the full frame
 * `<dir>/f<frame>-full.<ext>`, each with `-2`, `-3` … before the suffix when taken.
 *
 * @param capturesDir - The day folder (`dayFolder`).
 * @param name - The ui key or name of the picked element, "area" for an area (unsafe characters become "-").
 * @param frame - The frame of the shot.
 * @param taken - Paths already in the folder.
 * @param extensions - The extension of each picture (`imageExtension`).
 * @returns The crop and the full frame paths.
 * @example
 * ```ts
 * pickPaths(".moku/captures/2026-10-05", "settingsBoard", 1841, new Set(), { crop: "jpg", full: "jpg" });
 * // { crop: ".moku/captures/2026-10-05/settingsBoard-f1841-crop.jpg", full: ".moku/captures/2026-10-05/f1841-full.jpg" }
 * ```
 */
export function pickPaths(
  capturesDir: string,
  name: string,
  frame: number,
  taken: ReadonlySet<string>,
  extensions: PickExtensions
): { readonly crop: string; readonly full: string } {
  return {
    crop: firstFree(
      `${capturesDir}/${safeName(name)}-f${frame}`,
      `-crop.${extensions.crop}`,
      taken
    ),
    full: firstFree(`${capturesDir}/f${frame}`, `-full.${extensions.full}`, taken)
  };
}

/**
 * The card file of a reference (round 2b R13): `<dir>/<name>-f<frame>.md`, with `-2`, `-3` …
 * when taken.
 *
 * @param capturesDir - The folder of the card (`cardFolder`).
 * @param name - The ui key or name of the element (unsafe characters become "-").
 * @param frame - The frame of the reference.
 * @param taken - Paths already in the folder.
 * @returns The card path.
 * @example
 * ```ts
 * cardPath(".moku/captures/2026-10-05", "settingsBoard", 25, new Set()); // ".moku/captures/2026-10-05/settingsBoard-f25.md"
 * ```
 */
export function cardPath(
  capturesDir: string,
  name: string,
  frame: number,
  taken: ReadonlySet<string>
): string {
  return firstFree(`${capturesDir}/${safeName(name)}-f${frame}`, ".md", taken);
}

/**
 * The id of a pick bookmark: `<name>-f<frame>`, with `-2`, `-3` … when taken.
 *
 * @param name - The ui key or name of the picked element (unsafe characters become "-").
 * @param frame - The frame of the bookmark.
 * @param taken - The ids already kept.
 * @returns The id.
 * @example
 * ```ts
 * bookmarkId("card0", 96, new Set(["card0-f96"])); // "card0-f96-2"
 * ```
 */
export function bookmarkId(name: string, frame: number, taken: ReadonlySet<string>): string {
  return firstFree(`${safeName(name)}-f${frame}`, "", taken);
}

/**
 * A name a file keeps: every run of unsafe characters becomes "-".
 *
 * @param name - A node name.
 * @returns The safe name.
 * @example
 * ```ts
 * safeName("board.cells/3"); // "board-cells-3"
 * ```
 */
function safeName(name: string): string {
  return name.replaceAll(UNSAFE_NAME, "-");
}

/**
 * The series folder `<dir>/series-<stamp>/`, with `-2` … when taken; ends with "/".
 *
 * @param capturesDir - The day folder (`dayFolder`).
 * @param minute - The stamp.
 * @param taken - Paths already in the folder (folders without a trailing slash).
 * @returns The folder path with a trailing slash.
 * @example
 * ```ts
 * seriesFolder(".moku/captures/2026-10-05", "1015", new Set()); // ".moku/captures/2026-10-05/series-1015/"
 * ```
 */
export function seriesFolder(
  capturesDir: string,
  minute: string,
  taken: ReadonlySet<string>
): string {
  const base = `${capturesDir}/series-${minute}`;
  return `${firstFree(base, "", taken)}/`;
}

/**
 * The file name of shot `index` of `count`: from 1, zero-padded to max(3, digits of count).
 *
 * @param index - 0-based shot index.
 * @param count - Shots in the series.
 * @returns "001.png".
 * @example
 * ```ts
 * shotName(19, 20); // "020.png"
 * ```
 */
export function shotName(index: number, count: number): string {
  const width = Math.max(MIN_SHOT_DIGITS, String(count).length);
  return `${String(index + 1).padStart(width, "0")}.png`;
}

/**
 * Path, flow and node of a game.position value (only the strings present).
 *
 * @param value - The game.position value.
 * @returns The position info.
 * @example
 * ```ts
 * positionOf({ path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: [] }).flow; // "board"
 * ```
 */
export function positionOf(value: Json): PositionInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const info: { path?: string; flow?: string; node?: string } = {};
  if (typeof value.path === "string") info.path = value.path;
  if (typeof value.flow === "string") info.flow = value.flow;
  if (typeof value.node === "string") info.node = value.node;
  return info;
}

/**
 * The node part of a screenshot name: the flow, else "game".
 *
 * @param position - The position info.
 * @returns The name part.
 * @example
 * ```ts
 * nodeOf({}); // "game"
 * ```
 */
export function nodeOf(position: PositionInfo): string {
  return position.flow ?? "game";
}

/**
 * The folder of a path, with its trailing slash ("" for a bare name).
 *
 * @param path - A file path.
 * @returns The folder.
 * @example
 * ```ts
 * folderOf(".moku/captures/2026-10-05/series-1015/index.json"); // ".moku/captures/2026-10-05/series-1015/"
 * ```
 */
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Planned shots of a series: floor(duration / interval), 0 for a zero interval.
 *
 * @param durationMs - Length.
 * @param intervalMs - Spacing.
 * @returns The shot count.
 * @example
 * ```ts
 * plannedShots(2000, 100); // 20
 * ```
 */
export function plannedShots(durationMs: number, intervalMs: number): number {
  return intervalMs > 0 ? Math.floor(durationMs / intervalMs) : 0;
}

/**
 * The device text of a capture: preset name and orientation.
 *
 * @param name - The preset name.
 * @param orientation - The orientation of the shot.
 * @returns "iPhone 15 portrait".
 * @example
 * ```ts
 * deviceLabel("Pixel 8", "landscape"); // "Pixel 8 landscape"
 * ```
 */
export function deviceLabel(name: string, orientation: "portrait" | "landscape"): string {
  return `${name} ${orientation}`;
}

/**
 * The paths of a folder listing.
 *
 * @param entries - The listing.
 * @returns The set of paths.
 * @example
 * ```ts
 * takenPaths([{ path: "a.png", kind: "file", size: 1 }]); // Set { "a.png" }
 * ```
 */
export function takenPaths(entries: readonly FileEntry[]): ReadonlySet<string> {
  return new Set(entries.map(entry => entry.path));
}
