/**
 * @file flowView notes module — note file names: `<YYYY-MM-DD>-<slug>.md` (local date), the slug
 * from the title, and a `-2`, `-3` … suffix when the name is taken.
 */

/**
 * Longest slug.
 */
const MAX_SLUG = 48;

/**
 * Runs of characters outside [a-z0-9].
 */
const NON_WORD = /[^\da-z]+/g;

/**
 * The slug of a title: lowercased, non-[a-z0-9] runs → "-", trimmed, at most 48 characters;
 * "note" when nothing is left.
 *
 * @param title - The note title.
 * @returns The slug.
 * @example
 * ```ts
 * slugOf("First wood 4: show a 'new item' popup"); // "first-wood-4-show-a-new-item-popup"
 * ```
 */
export function slugOf(title: string): string {
  const slug = title.toLowerCase().replaceAll(NON_WORD, "-");
  let start = 0;
  let end = slug.length;
  while (start < end && slug.charAt(start) === "-") start += 1;
  while (end > start && slug.charAt(end - 1) === "-") end -= 1;
  let cut = slug.slice(start, Math.min(end, start + MAX_SLUG));
  while (cut.endsWith("-")) cut = cut.slice(0, -1);
  return cut === "" ? "note" : cut;
}

/**
 * The local date as YYYY-MM-DD.
 *
 * @param date - The date.
 * @returns The stamp.
 * @example
 * ```ts
 * dateStamp(new Date(2026, 8, 24)); // "2026-09-24"
 * ```
 */
export function dateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The file name of a new note: `<date>-<slug>.md`, with `-2`, `-3` … while the name is taken.
 *
 * @param date - Creation date (local).
 * @param title - The note title.
 * @param taken - File names already in notesDir.
 * @returns The file name.
 * @example
 * ```ts
 * noteFileName(new Date(2026, 8, 24), "First top item", new Set()); // "2026-09-24-first-top-item.md"
 * ```
 */
export function noteFileName(date: Date, title: string, taken: ReadonlySet<string>): string {
  const stem = `${dateStamp(date)}-${slugOf(title)}`;
  let name = `${stem}.md`;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${stem}-${suffix}.md`;
    suffix += 1;
  }
  return name;
}
