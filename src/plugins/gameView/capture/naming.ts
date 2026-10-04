/**
 * @file gameView plugin — capture names (pure): the local minute stamp, screenshot paths, the two
 * files, the card file (round 2b R13) and the bookmark id of a pick, and series folders with `-2`, `-3` … on a collision,
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
 * Characters a file name keeps; every other run becomes "-".
 */
const UNSAFE_NAME = /[^\w-]+/g;

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
 * The local date and minute as `yyyy-mm-dd-hhmm`.
 *
 * @param date - The moment.
 * @returns The stamp.
 * @example
 * ```ts
 * stamp(new Date(2026, 8, 24, 10, 12)); // "2026-09-24-1012"
 * ```
 */
export function stamp(date: Date): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day}-${two(date.getHours())}${two(date.getMinutes())}`;
}

/**
 * The first free name of `base`, `base-2`, `base-3` … with a suffix.
 *
 * @param base - The name without suffix.
 * @param suffix - ".png" or "".
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
 * The screenshot path `<dir>/<stamp>-<node>.png`, with `-2`, `-3` … when taken.
 *
 * @param capturesDir - The captures folder.
 * @param minute - The stamp.
 * @param node - The node name (unsafe characters become "-").
 * @param taken - Paths already in the folder.
 * @returns The path.
 * @example
 * ```ts
 * capturePath(".moku/captures", "2026-09-24-1012", "board", new Set()); // ".moku/captures/2026-09-24-1012-board.png"
 * ```
 */
export function capturePath(
  capturesDir: string,
  minute: string,
  node: string,
  taken: ReadonlySet<string>
): string {
  return firstFree(`${capturesDir}/${minute}-${safeName(node)}`, ".png", taken);
}

/**
 * The two files of a pick: the crop `<dir>/<name>-f<frame>.png` and the full frame
 * `<dir>/f<frame>.png`, each with `-2`, `-3` … when taken.
 *
 * @param capturesDir - The captures folder.
 * @param name - The ui key or name of the picked element (unsafe characters become "-").
 * @param frame - The frame of the shot.
 * @param taken - Paths already in the folder.
 * @returns The crop and the full frame paths.
 * @example
 * ```ts
 * pickPaths(".moku/captures", "settingsBoard", 1841, new Set()); // { crop: ".moku/captures/settingsBoard-f1841.png", full: ".moku/captures/f1841.png" }
 * ```
 */
export function pickPaths(
  capturesDir: string,
  name: string,
  frame: number,
  taken: ReadonlySet<string>
): { readonly crop: string; readonly full: string } {
  return {
    crop: firstFree(`${capturesDir}/${safeName(name)}-f${frame}`, ".png", taken),
    full: firstFree(`${capturesDir}/f${frame}`, ".png", taken)
  };
}

/**
 * The card file of a reference (round 2b R13): `<dir>/<name>-f<frame>.md`, with `-2`, `-3` …
 * when taken.
 *
 * @param capturesDir - The captures folder.
 * @param name - The ui key or name of the element (unsafe characters become "-").
 * @param frame - The frame of the reference.
 * @param taken - Paths already in the folder.
 * @returns The card path.
 * @example
 * ```ts
 * cardPath(".moku/captures", "settingsBoard", 25, new Set()); // ".moku/captures/settingsBoard-f25.md"
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
 * @param capturesDir - The captures folder.
 * @param minute - The stamp.
 * @param taken - Paths already in the folder (folders without a trailing slash).
 * @returns The folder path with a trailing slash.
 * @example
 * ```ts
 * seriesFolder(".moku/captures", "2026-09-24-1015", new Set()); // ".moku/captures/series-2026-09-24-1015/"
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
  const width = Math.max(3, String(count).length);
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
 * folderOf(".moku/captures/series-a/index.json"); // ".moku/captures/series-a/"
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
