/**
 * @file collector plugin — the name of a computer file: `perf-<yyyymmdd-hhmm>-<model>.jsonl`, the
 * local minute the log opened and the model as a slug, never a name already taken. Pure.
 */

/** The longest model slug in a file name. */
const MAX_SLUG = 40;

/**
 * Two digits.
 *
 * @param value - A whole number.
 * @returns It, padded with a zero.
 * @example
 * ```ts
 * twoDigits(4); // "04"
 * ```
 */
function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Text without leading and trailing dashes.
 *
 * @param text - The text.
 * @returns It, trimmed of dashes.
 * @example
 * ```ts
 * trimDashes("-sm-a266b-"); // "sm-a266b"
 * ```
 */
function trimDashes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "-") start += 1;
  while (end > start && text[end - 1] === "-") end -= 1;

  return text.slice(start, end);
}

/**
 * The model as a slug: lower case, runs of characters outside `[a-z0-9-]` to one `-`, trimmed of
 * dashes, at most 40 characters; "device" when nothing is left.
 *
 * @param model - The normalized model.
 * @returns The slug.
 * @example
 * ```ts
 * slugOf("Pixel 8 Pro/US"); // "pixel-8-pro-us"
 * ```
 */
function slugOf(model: string): string {
  const slug = trimDashes(
    trimDashes(model.toLowerCase().replaceAll(/[^\da-z-]+/g, "-")).slice(0, MAX_SLUG)
  );
  return slug === "" ? "device" : slug;
}

/**
 * The file name of a new device log: the local minute and the model slug, with `-2`, `-3` … when
 * the name is taken on disk or by another session.
 *
 * @param date - When the log opened.
 * @param model - The normalized model.
 * @param taken - Whether a name is taken.
 * @returns The file name.
 * @example
 * ```ts
 * fileNameOf(new Date(2026, 9, 14, 15, 32), "SM-A266B", () => false); // "perf-20261014-1532-sm-a266b.jsonl"
 * ```
 */
export function fileNameOf(date: Date, model: string, taken: (name: string) => boolean): string {
  const day = `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}`;
  const base = `perf-${day}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}-${slugOf(model)}`;
  let name = `${base}.jsonl`;
  let suffix = 1;
  while (taken(name)) {
    suffix += 1;
    name = `${base}-${suffix}.jsonl`;
  }

  return name;
}
