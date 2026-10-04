/**
 * @file gameView plugin — the JSX of a picked element in its source (round 2b R12), pure: the
 * column of its key on the key line, and the lines of the element around it: from the line that
 * opens its tag to the line that closes the element (its `/>` or its closing tag). Braces are
 * skipped whole (attribute values, expression children with their own JSX), so arrows and
 * comparisons inside them close nothing; strings, template literals and comments inside braces
 * are skipped too. A key line that is not inside a tag (the template line of a loop key in a
 * helper) is the element's only line.
 */
import { keyPattern, loopKeyPattern } from "./source";

/**
 * The first character of a tag name.
 */
const TAG_START = /[$A-Z_a-z]/;

/**
 * The lines above the key line searched for the `<` that opens its tag.
 */
const TAG_LOOKBACK = 8;

/**
 * The first and the last 1-based line of an element.
 */
export type LineRange = { readonly start: number; readonly end: number };

/**
 * The column of a key on its line: the `key=` / `id=` attribute, else the template literal that
 * builds a loop key; 0 when neither is on the line.
 *
 * @param line - The key line.
 * @param key - The ui key.
 * @returns The 0-based column.
 * @example
 * ```ts
 * keyColumn('        id="settingsBoard"', "settingsBoard"); // 8
 * ```
 */
export function keyColumn(line: string, key: string): number {
  const literal = keyPattern(key).exec(line);
  if (literal !== null) return literal.index;
  return loopKeyPattern(key)?.exec(line)?.index ?? 0;
}

/**
 * The offset where each line starts in the joined text.
 *
 * @param lines - The lines.
 * @returns One offset per line.
 */
function lineStarts(lines: readonly string[]): readonly number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

/**
 * The 1-based line of an offset.
 *
 * @param starts - The line starts.
 * @param offset - An offset in the joined text.
 * @returns The line.
 */
function lineOf(starts: readonly number[], offset: number): number {
  let line = 0;
  while (line + 1 < starts.length && (starts[line + 1] ?? 0) <= offset) line += 1;
  return line + 1;
}

/**
 * The `<` of the tag a position is inside: searched backwards, stopped by a `>` that ends a tag
 * (not the one of `=>`), by a `;`, or at the floor.
 *
 * @param text - The joined text.
 * @param at - The position (the key).
 * @param floor - The lowest offset searched.
 * @returns The offset of the `<`, undefined when the position is in no tag.
 */
function openingTag(text: string, at: number, floor: number): number | undefined {
  for (let index = at - 1; index >= floor; index -= 1) {
    const char = text.charAt(index);
    if (char === "<" && TAG_START.test(text.charAt(index + 1))) return index;
    if (char === ";" || (char === ">" && text.charAt(index - 1) !== "=")) return undefined;
  }
  return undefined;
}

/**
 * The end of a string or a comment that starts at an offset.
 *
 * @param text - The joined text.
 * @param start - Where the quote or the comment opens.
 * @returns The offset after it, undefined when nothing opens there.
 */
function skipLiteral(text: string, start: number): number | undefined {
  const char = text.charAt(start);
  const next = text.charAt(start + 1);
  if (char === "/" && next === "/") {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  if (char === "/" && next === "*") {
    const end = text.indexOf("*/", start + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (char === "`") return skipTemplate(text, start);
  if (char !== '"' && char !== "'") return undefined;

  let index = start + 1;
  while (index < text.length && text.charAt(index) !== char) {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }
  return index + 1;
}

/**
 * The end of a template literal, its `${…}` parts skipped as braces.
 *
 * @param text - The joined text.
 * @param start - The opening backtick.
 * @returns The offset after the closing backtick.
 */
function skipTemplate(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text.charAt(index) !== "`") {
    if (text.charAt(index) === "\\") index += 2;
    else if (text.startsWith("${", index)) index = skipBraces(text, index + 1);
    else index += 1;
  }
  return index + 1;
}

/**
 * The end of a braced expression, nested braces, strings and comments included.
 *
 * @param text - The joined text.
 * @param start - The opening brace.
 * @returns The offset after the closing brace (the text length when it never closes).
 */
function skipBraces(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const literal = skipLiteral(text, index);
    if (literal !== undefined) {
      index = literal;
      continue;
    }
    const char = text.charAt(index);
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    index += 1;
    if (depth === 0) return index;
  }
  return text.length;
}

/**
 * The `>` that ends a tag opened just before `start`: attribute values in braces and quotes are
 * skipped.
 *
 * @param text - The joined text.
 * @param start - The offset after the `<`.
 * @returns The offset of the `>`, undefined when the tag never ends.
 */
function tagEnd(text: string, start: number): number | undefined {
  let index = start;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === ">") return index;
    if (char === "{") index = skipBraces(text, index);
    else if (char === '"' || char === "'") index = skipLiteral(text, index) ?? index + 1;
    else index += 1;
  }
  return undefined;
}

/**
 * The offset where the element that opens at `open` ends: its `/>`, or the `>` of its closing
 * tag. Nested elements and fragments are counted; braced children are skipped whole.
 *
 * @param text - The joined text.
 * @param open - The `<` of the element's tag.
 * @returns The end offset, undefined when the element never closes.
 */
function elementEnd(text: string, open: number): number | undefined {
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === "{" && depth > 0) {
      index = skipBraces(text, index);
      continue;
    }
    if (char !== "<" || !(next === "/" || next === ">" || TAG_START.test(next))) {
      index += 1;
      continue;
    }

    const end = tagEnd(text, index + 1);
    if (end === undefined) return undefined;
    if (next === "/") depth -= 1;
    else if (text.charAt(end - 1) !== "/") depth += 1;
    if (depth === 0) return end;
    index = end + 1;
  }
  return undefined;
}

/**
 * The lines of the element whose key sits at a line and column: from the line of the `<` that
 * opens its tag (up to eight lines above) to the line where it closes. A key in no tag, or an
 * element that never closes, gives the key line alone (or the tag line to the key line).
 *
 * @param lines - The file lines.
 * @param line - The 1-based key line.
 * @param column - The 0-based column of the key on it.
 * @returns The first and the last line of the element.
 * @example
 * ```ts
 * elementLines(['<Pill key="coinPill" style={coinPill} />'], 1, 6); // { start: 1, end: 1 }
 * ```
 */
export function elementLines(lines: readonly string[], line: number, column: number): LineRange {
  const text = lines.join("\n");
  const starts = lineStarts(lines);
  const at = (starts[line - 1] ?? 0) + column;
  const floor = starts[Math.max(0, line - 1 - TAG_LOOKBACK)] ?? 0;

  const open = openingTag(text, at, floor);
  if (open === undefined) return { start: line, end: line };
  const start = lineOf(starts, open);
  const end = elementEnd(text, open);
  return { start, end: end === undefined ? line : lineOf(starts, end) };
}
