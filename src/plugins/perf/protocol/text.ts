/**
 * @file perf/protocol — `cleanText`: a phone's text made safe to print in a terminal or a page.
 * Every string a device sends (a flow path, a build, a mark or overlay label, a sensor name) passes
 * through it before the editor shows it. Runtime-free.
 */

/** The longest text `cleanText` keeps by default, in characters. */
export const CLEAN_TEXT_MAX = 128;

/**
 * The code point ranges `cleanText` drops: C0 controls, DEL and C1 controls, the bidi embeddings and
 * overrides (U+202A–U+202E) and the bidi isolates (U+2066–U+2069).
 */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x20_2a, 0x20_2e],
  [0x20_66, 0x20_69]
];

/**
 * Whether a character is a control or a bidi character.
 *
 * @param char - One character (a code point).
 * @returns Whether `cleanText` drops it.
 * @example
 * ```ts
 * isUnsafe("‮"); // true
 * ```
 */
function isUnsafe(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high);
}

/**
 * A phone's text, safe to print: control characters (C0, DEL, C1) and bidi embeddings, overrides
 * and isolates dropped, then at most `max` characters (code points, so a character is never cut in
 * half).
 *
 * @param text - The text as the phone sent it.
 * @param max - The most characters kept (128 by default).
 * @returns The clean text.
 * @example
 * ```ts
 * cleanText("garden\u001b[2J‮/boss"); // "garden[2J/boss"
 * ```
 */
export function cleanText(text: string, max: number = CLEAN_TEXT_MAX): string {
  return [...text]
    .filter(char => !isUnsafe(char))
    .slice(0, max)
    .join("");
}
