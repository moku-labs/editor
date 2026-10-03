/**
 * @file workspace plugin — palette matching (pure): label + keywords lower-cased; a prefix scores
 * 100, a word start 80, a substring 60 (one highlight range in the label); `fuzzyScore` is the
 * subsequence fallback (20 + a contiguity bonus, one range per character).
 */
import type { PaletteItem, PaletteMatch } from "../types";

/**
 * Score of a match at the start of the text.
 */
const PREFIX_SCORE = 100;

/**
 * Score of a match at the start of a later word.
 */
const WORD_SCORE = 80;

/**
 * Score of a match inside a word.
 */
const SUBSTRING_SCORE = 60;

/**
 * Base score of a fuzzy (subsequence) match.
 */
const FUZZY_SCORE = 20;

/**
 * A letter or digit (a character that continues a word).
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Where the query sits in a text and how well.
 *
 * @param text - Lower-cased text.
 * @param query - Lower-cased, trimmed query.
 * @returns The score and the start index, undefined without a substring hit.
 * @example
 * ```ts
 * findIn("board/merge", "mer"); // { score: 80, start: 6 }
 * ```
 */
function findIn(text: string, query: string): { score: number; start: number } | undefined {
  if (text.startsWith(query)) return { score: PREFIX_SCORE, start: 0 };

  let start = text.indexOf(query);
  const first = start;
  while (start > 0) {
    if (!WORD_CHARACTER.test(text.charAt(start - 1))) return { score: WORD_SCORE, start };
    start = text.indexOf(query, start + 1);
  }
  return first === -1 ? undefined : { score: SUBSTRING_SCORE, start: first };
}

/**
 * Scores an item against a query: the label first (with a highlight range), then the keywords
 * (without one). An empty query matches everything with score 0.
 *
 * @param item - A palette item.
 * @param query - What the user typed.
 * @returns The match, undefined when neither the label nor the keywords hold the query.
 * @example
 * ```ts
 * scoreItem({ id: "n", group: "Nodes", label: "board/merge", run }, "mer"); // { score: 80, ranges: [[6, 9]] }
 * ```
 */
export function scoreItem(item: PaletteItem, query: string): PaletteMatch | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { score: 0, ranges: [] };

  const label = findIn(item.label.toLowerCase(), needle);
  if (label !== undefined) {
    return { score: label.score, ranges: [[label.start, label.start + needle.length]] };
  }

  const keywords =
    item.keywords === undefined ? undefined : findIn(item.keywords.toLowerCase(), needle);
  return keywords === undefined ? undefined : { score: keywords.score, ranges: [] };
}

/**
 * Fuzzy fallback: the query letters (spaces ignored) in order anywhere in the text. Score 20 plus
 * one per pair of matched letters that sit next to each other.
 *
 * @param text - The label.
 * @param query - What the user typed.
 * @returns The match with one range per letter, undefined when the letters are not in order.
 * @example
 * ```ts
 * fuzzyScore("board/merge", "bmg"); // { score: 20, ranges: [[0, 1], [6, 7], [9, 10]] }
 * ```
 */
export function fuzzyScore(text: string, query: string): PaletteMatch | undefined {
  const needle = query.toLowerCase().replaceAll(/\s+/g, "");
  if (needle === "") return undefined;

  const haystack = text.toLowerCase();
  const ranges: [number, number][] = [];
  let from = 0;
  let bonus = 0;
  for (const letter of needle) {
    const index = haystack.indexOf(letter, from);
    if (index === -1) return undefined;
    if (ranges.length > 0 && index === from) bonus += 1;
    ranges.push([index, index + 1]);
    from = index + 1;
  }
  return { score: FUZZY_SCORE + bonus, ranges };
}
