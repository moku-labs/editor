/**
 * @file gameView plugin — the source text of a project-index answer, pure (round 2b R12, D-38):
 * the lines of its range (a JSX element from the line that opens its tag to the line that closes
 * it, a component definition, a text style key, a `defineStyle` call), and the opening tag at the
 * start of a JSX range: its name and its attributes. Braces are skipped whole (attribute values,
 * spreads), with the strings, template literals and comments inside them, so an arrow or a
 * comparison in a value never ends the tag.
 */
import type { CodeSnippet, SourceRange } from "../types";

/**
 * The `<` and the name of an opening tag, read where the range starts (`<Signboard`, `<Kit.Button`).
 */
const OPENING_TAG = /<([$A-Z_a-z][\w$.:-]*)/y;

/**
 * A character of an attribute name (`style`, `data-style`, `xlink:href`).
 */
const NAME_CHAR = /[\w$:-]/;

/**
 * White space between the parts of an attribute.
 */
const SPACE = /\s/;

/**
 * One attribute of an opening tag: its name, the 1-based line it starts on, and its value: the
 * text inside the quotes of a string, or inside the braces of an expression (trimmed). A boolean
 * attribute (`hung`) has no value.
 *
 * @example
 * ```ts
 * const style: TagAttribute = { name: "style", line: 218, value: { braced: true, text: "orderCardStyle(card.slot)" } };
 * ```
 */
export type TagAttribute = {
  readonly name: string;
  readonly line: number;
  readonly value?: { readonly braced: boolean; readonly text: string };
};

/**
 * The lines of a range as a snippet, at most `max` of them.
 *
 * @param path - The file of the range.
 * @param text - Its text.
 * @param range - The answer's range; its start and end lines are used.
 * @param max - The most lines kept; all by default.
 * @returns The snippet from the start line.
 * @example
 * ```ts
 * // The JSX of the settings board: settings.tsx from line 300 to line 321.
 * snippetOf("features/settings/settings.tsx", text, [300, 7, 321, 19]).lines.length; // 22
 * ```
 */
export function snippetOf(
  path: string,
  text: string,
  range: SourceRange,
  max = Number.POSITIVE_INFINITY
): CodeSnippet {
  const start = range[0];
  const end = Math.min(range[2], start - 1 + max);
  return { path, line: start, lines: text.split("\n").slice(start - 1, end) };
}

/**
 * The name of the tag that opens where a range starts.
 *
 * @param lines - The file lines.
 * @param range - A JSX answer's range.
 * @returns The tag name, undefined when no tag opens there.
 * @example
 * ```ts
 * tagNameAt(['      <Signboard', '        id="settingsBoard"'], [1, 7, 2, 25]); // "Signboard"
 * ```
 */
export function tagNameAt(lines: readonly string[], range: SourceRange): string | undefined {
  OPENING_TAG.lastIndex = range[1] - 1;
  return OPENING_TAG.exec(lines[range[0] - 1] ?? "")?.[1];
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
 * The 1-based line of an offset, searched from a line known to be at or before it.
 *
 * @param starts - The line starts.
 * @param offset - An offset in the joined text.
 * @param from - A 0-based line at or before the offset.
 * @returns The line.
 */
function lineOf(starts: readonly number[], offset: number, from: number): number {
  let line = from;
  while (line + 1 < starts.length && (starts[line + 1] ?? 0) <= offset) line += 1;
  return line + 1;
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
 * The first offset at or after `start` that is not white space.
 *
 * @param text - The joined text.
 * @param start - An offset.
 * @returns The offset.
 */
function skipSpaces(text: string, start: number): number {
  let index = start;
  while (index < text.length && SPACE.test(text.charAt(index))) index += 1;
  return index;
}

/**
 * Reads one attribute whose name starts at an offset: its name, line and value.
 *
 * @param text - The joined text.
 * @param starts - The line starts.
 * @param start - The first character of the name.
 * @param from - A 0-based line at or before `start`.
 * @returns The attribute and the offset after it.
 */
function readAttribute(
  text: string,
  starts: readonly number[],
  start: number,
  from: number
): { readonly attribute: TagAttribute; readonly end: number } {
  let index = start;
  while (index < text.length && NAME_CHAR.test(text.charAt(index))) index += 1;
  const name = text.slice(start, index);
  const line = lineOf(starts, start, from);

  // A boolean attribute: no `=` follows the name.
  const equals = skipSpaces(text, index);
  if (text.charAt(equals) !== "=") return { attribute: { name, line }, end: index };

  const open = skipSpaces(text, equals + 1);
  const quote = text.charAt(open);
  if (quote === "{") {
    const end = skipBraces(text, open);
    const value = { braced: true, text: text.slice(open + 1, end - 1).trim() };
    return { attribute: { name, line, value }, end };
  }
  if (quote === '"' || quote === "'") {
    const end = skipLiteral(text, open) ?? open + 1;
    return {
      attribute: { name, line, value: { braced: false, text: text.slice(open + 1, end - 1) } },
      end
    };
  }
  return { attribute: { name, line }, end: open };
}

/**
 * The attributes of the tag that opens where a JSX range starts, up to the `>` or `/>` that ends
 * it. A spread (`{...props}`) is skipped.
 *
 * @param lines - The file lines.
 * @param range - A JSX answer's range.
 * @returns The attributes in order; empty when no tag opens there.
 * @example
 * ```ts
 * // merge-game's order card: <column key={id} state={…} style={orderCardStyle(card.slot)} …>
 * tagAttributes(stripLines, [215, 5, 247, 14]).find(attribute => attribute.name === "style");
 * // { name: "style", line: 218, value: { braced: true, text: "orderCardStyle(card.slot)" } }
 * ```
 */
export function tagAttributes(
  lines: readonly string[],
  range: SourceRange
): readonly TagAttribute[] {
  const text = lines.join("\n");
  const starts = lineStarts(lines);
  const from = range[0] - 1;
  OPENING_TAG.lastIndex = (starts[from] ?? text.length) + range[1] - 1;
  const tag = OPENING_TAG.exec(text);
  if (tag === null) return [];

  const attributes: TagAttribute[] = [];
  let index = tag.index + tag[0].length;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === ">" || text.startsWith("/>", index)) break;
    if (char === "{") {
      index = skipBraces(text, index);
    } else if (NAME_CHAR.test(char)) {
      const read = readAttribute(text, starts, index, from);
      attributes.push(read.attribute);
      index = read.end;
    } else {
      index += 1;
    }
  }
  return attributes;
}
