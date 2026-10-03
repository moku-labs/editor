/**
 * @file Shared view module — style blocks of a TypeScript source file and the one safe
 * numeric-literal edit with a version-checked write (flowView Styles C4, gameView Element C7).
 * Bounds and error codes live only here (R8).
 */
import type { FileText, WriteResult } from "../../registry/protocol";
import { errorCode, isWireError } from "../../registry/protocol";

/**
 * Which block of a style file: a text-style table entry or a `defineStyle` constant (R8, R9).
 */
export type StyleBlockRef =
  | { readonly kind: "text"; readonly key: string }
  | { readonly kind: "const"; readonly name: string };

/**
 * A numeric literal field with its exact columns.
 */
export type NumberField = {
  readonly kind: "number";
  /** "size", "shadow.dy", "padding.left". */
  readonly path: string;
  readonly value: number;
  /** The literal as written: "60", "0.55". */
  readonly raw: string;
  /** 1-based. */
  readonly line: number;
  /** 0-based; [colStart, colEnd) is the literal on that line. */
  readonly colStart: number;
  readonly colEnd: number;
};

/**
 * Any other field (identifier, string, boolean, hex, expression): read-only.
 */
export type OtherField = {
  readonly kind: "other";
  readonly path: string;
  readonly raw: string;
  readonly line: number;
};

/**
 * One field of a style block.
 */
export type StyleField = NumberField | OtherField;

/**
 * One style block and its fields.
 */
export type StyleBlock = {
  readonly ref: StyleBlockRef;
  readonly line: number;
  readonly endLine: number;
  readonly fields: readonly StyleField[];
};

/**
 * A parsed style file.
 */
export type StyleFile = {
  readonly blocks: readonly StyleBlock[];
  /** Identifier → "#rrggbb", for read-only swatches. */
  readonly colours: ReadonlyMap<string, string>;
  readonly eol: "\n" | "\r\n";
};

/**
 * Why an edit was refused.
 */
export type StyleEditCode =
  | "no-file"
  | "parse"
  | "no-key"
  | "ambiguous"
  | "not-literal"
  | "read-only"
  | "changed-on-disk"
  | "out-of-range";

/**
 * A refused edit (returned, never thrown).
 */
export type StyleEditError = {
  readonly error: StyleEditCode;
  readonly line?: number;
  readonly key?: string;
  readonly path?: string;
};

/**
 * Stepper bounds of one field.
 */
export type FieldRule = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly bigStep: number;
  readonly integer: boolean;
};

/**
 * What the card showed: block, field path and the literal as written.
 */
export type EditTarget = {
  readonly ref: StyleBlockRef;
  readonly path: string;
  readonly raw: string;
};

/**
 * An edited text.
 */
export type EditDone = { readonly text: string; readonly line: number };

/**
 * A successful write.
 */
export type WriteDone = {
  readonly ok: true;
  readonly text: string;
  readonly line: number;
  readonly version: string;
  readonly bytes: number;
};

/**
 * Structural files client: link.files and tools.files fit it.
 */
export type StyleFiles = {
  read(path: string): Promise<FileText>;
  write(path: string, text: string, version?: string): Promise<WriteResult>;
};

/**
 * A loaded style file: its text, version and parsed blocks.
 */
export type LoadedStyleFile = {
  readonly text: string;
  readonly version: string;
  readonly file: StyleFile;
};

// ─────────────────────────────────────────────────────────────────────────────
// Scanner: what every character of the text is.
// ─────────────────────────────────────────────────────────────────────────────

/** A character of code: braces, commas and colons count. */
const CODE = 0;
/** A character of a string or template text (quotes included). */
const QUOTED = 1;
/** A character of a comment. */
const COMMENT = 2;

/**
 * The scanned text: the kind of every character, the line starts and the brace partners.
 */
type Scan = {
  readonly text: string;
  readonly kinds: Uint8Array;
  /** Index of the first character of each line. */
  readonly lineStarts: readonly number[];
  /** For an index of a code `{`: the index of its `}`; -1 when it never closes. */
  readonly partners: Int32Array;
  /** Index of the first brace that never balances; -1 when every brace balances. */
  readonly unbalanced: number;
};

/**
 * The mutable cursor of the character classifier.
 */
type Cursor = {
  readonly text: string;
  readonly kinds: Uint8Array;
  index: number;
  /** One entry per open `${`: the code brace nesting inside it. */
  readonly holes: number[];
  inTemplate: boolean;
};

/**
 * Marks `[from, to)` with one kind.
 *
 * @param cursor - The classifier cursor.
 * @param from - First index.
 * @param to - End index (exclusive).
 * @param kind - QUOTED or COMMENT.
 * @returns The end index, the next position of the cursor.
 * @example
 * ```ts
 * cursor.index = mark(cursor, 4, 9, QUOTED);
 * ```
 */
function mark(cursor: Cursor, from: number, to: number, kind: number): number {
  const end = Math.min(to, cursor.text.length);
  cursor.kinds.fill(kind, from, end);
  return end;
}

/**
 * The end of a quoted string that starts at `start`: after the closing quote, or before the line
 * break of an unterminated string.
 *
 * @param text - The text.
 * @param start - Index of the opening quote.
 * @returns The end index (exclusive).
 * @example
 * ```ts
 * stringEnd('a = "x";', 4); // 7
 * ```
 */
function stringEnd(text: string, start: number): number {
  const quote = text.charAt(start);
  let index = start + 1;

  while (index < text.length && text.charAt(index) !== quote && text.charAt(index) !== "\n") {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }

  return text.charAt(index) === quote ? index + 1 : Math.min(index, text.length);
}

/**
 * The end of a comment that starts at `start` (`//` to the line break, `/* … *\/` inclusive).
 *
 * @param text - The text.
 * @param start - Index of the first `/`.
 * @returns The end index (exclusive).
 * @example
 * ```ts
 * commentEnd("// x\ny", 0); // 4
 * ```
 */
function commentEnd(text: string, start: number): number {
  if (text[start + 1] === "/") {
    const lineBreak = text.indexOf("\n", start);
    return lineBreak === -1 ? text.length : lineBreak;
  }

  const close = text.indexOf("*/", start + 2);
  return close === -1 ? text.length : close + 2;
}

/**
 * Classifies one step of template text: an escape, the closing backtick, a `${` or one character.
 *
 * @param cursor - The classifier cursor, inside template text.
 */
function stepTemplate(cursor: Cursor): void {
  const { text, index } = cursor;
  const char = text[index];

  if (char === "\\") {
    cursor.index = mark(cursor, index, index + 2, QUOTED);
  } else if (char === "`") {
    cursor.index = mark(cursor, index, index + 1, QUOTED);
    cursor.inTemplate = false;
  } else if (char === "$" && text[index + 1] === "{") {
    cursor.index = mark(cursor, index, index + 2, QUOTED);
    cursor.holes.push(0);
    cursor.inTemplate = false;
  } else {
    cursor.index = mark(cursor, index, index + 1, QUOTED);
  }
}

/**
 * Classifies a code brace: nesting inside an open `${`, or the `}` that closes it.
 *
 * @param cursor - The classifier cursor, on a `{` or `}` of code.
 * @param char - The brace.
 */
function stepBrace(cursor: Cursor, char: string): void {
  const top = cursor.holes.length - 1;
  const nesting = cursor.holes[top];

  if (nesting === undefined) {
    cursor.index += 1;
  } else if (char === "{") {
    cursor.holes[top] = nesting + 1;
    cursor.index += 1;
  } else if (nesting > 0) {
    cursor.holes[top] = nesting - 1;
    cursor.index += 1;
  } else {
    cursor.holes.pop();
    cursor.index = mark(cursor, cursor.index, cursor.index + 1, QUOTED);
    cursor.inTemplate = true;
  }
}

/**
 * Classifies one step of code: a comment, a string, a template start, a brace or one character.
 *
 * @param cursor - The classifier cursor, in code.
 */
function stepCode(cursor: Cursor): void {
  const { text, index } = cursor;
  const char = text.charAt(index);
  const next = text.charAt(index + 1);

  if (char === "/" && (next === "/" || next === "*")) {
    cursor.index = mark(cursor, index, commentEnd(text, index), COMMENT);
    return;
  }

  switch (char) {
    case '"':
    case "'": {
      cursor.index = mark(cursor, index, stringEnd(text, index), QUOTED);
      break;
    }
    case "`": {
      cursor.index = mark(cursor, index, index + 1, QUOTED);
      cursor.inTemplate = true;
      break;
    }
    case "{":
    case "}": {
      stepBrace(cursor, char);
      break;
    }
    default: {
      cursor.index += 1;
    }
  }
}

/**
 * The kind of every character: code, quoted (strings, template text) or comment.
 *
 * @param text - The file text.
 * @returns One kind per character.
 * @example
 * ```ts
 * classify('a = "{"')[4]; // QUOTED
 * ```
 */
function classify(text: string): Uint8Array {
  const cursor: Cursor = {
    text,
    kinds: new Uint8Array(text.length),
    index: 0,
    holes: [],
    inTemplate: false
  };

  while (cursor.index < text.length) {
    if (cursor.inTemplate) stepTemplate(cursor);
    else stepCode(cursor);
  }

  return cursor.kinds;
}

/**
 * Pairs every code `{` with its `}` and finds the first brace that never balances.
 *
 * @param text - The file text.
 * @param kinds - The character kinds.
 * @returns The partners and the first unbalanced index (-1 when balanced).
 * @example
 * ```ts
 * pairBraces("{}", kinds).partners[0]; // 1
 * ```
 */
function pairBraces(
  text: string,
  kinds: Uint8Array
): { readonly partners: Int32Array; readonly unbalanced: number } {
  const partners = new Int32Array(text.length).fill(-1);
  const open: number[] = [];

  let index = -1;

  while (++index < text.length) {
    if (kinds[index] !== CODE) continue;
    const char = text.charAt(index);
    if (char === "{") open.push(index);
    if (char !== "}") continue;
    const start = open.pop();
    if (start === undefined) return { partners, unbalanced: index };
    partners[start] = index;
  }

  return { partners, unbalanced: open[0] ?? -1 };
}

/**
 * Scans a text: character kinds, line starts and brace partners.
 *
 * @param text - The file text.
 * @returns The scan.
 */
function scanText(text: string): Scan {
  const kinds = classify(text);
  const lineStarts = [0];

  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }

  return { text, kinds, lineStarts, ...pairBraces(text, kinds) };
}

/**
 * The 1-based line of an index.
 *
 * @param scan - The scan.
 * @param index - A character index.
 * @returns The line number.
 * @example
 * ```ts
 * lineOf(scan, 0); // 1
 * ```
 */
function lineOf(scan: Scan, index: number): number {
  let low = 0;
  let high = scan.lineStarts.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((scan.lineStarts[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }

  return low + 1;
}

/**
 * The text of a 1-based line without its line break.
 *
 * @param scan - The scan.
 * @param line - The line number.
 * @returns The line text (a trailing `\r` removed).
 * @example
 * ```ts
 * lineText(scan, 1); // "const cream = 0xff_f3_d6;"
 * ```
 */
function lineText(scan: Scan, line: number): string {
  const start = scan.lineStarts[line - 1] ?? scan.text.length;
  const next = scan.lineStarts[line];
  const end = next === undefined ? scan.text.length : next - 1;
  const text = scan.text.slice(start, end);

  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fields
// ─────────────────────────────────────────────────────────────────────────────

/** A number literal as the steppers write it. */
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;

/** Raw text kept of an object or array field deeper than the steppers go. */
const DEEP_RAW_LIMIT = 40;

/** Opening brackets that nest a value. */
const OPENERS = new Set(["{", "[", "("]);

/** Closing brackets that end a nesting. */
const CLOSERS = new Set(["}", "]", ")"]);

/**
 * True for a character that carries meaning: not whitespace and not a comment.
 *
 * @param scan - The scan.
 * @param index - A character index.
 * @returns Whether the character is significant.
 */
function isSignificant(scan: Scan, index: number): boolean {
  return scan.kinds[index] !== COMMENT && (scan.text[index] ?? " ").trim() !== "";
}

/**
 * Narrows `[start, end)` to its first and last significant characters.
 *
 * @param scan - The scan.
 * @param start - First index.
 * @param end - End index (exclusive).
 * @returns The trimmed range; empty when start equals end.
 */
function trimRange(scan: Scan, start: number, end: number): [number, number] {
  let from = start;
  let to = end;

  while (from < to && !isSignificant(scan, from)) from += 1;
  while (to > from && !isSignificant(scan, to - 1)) to -= 1;

  return [from, to];
}

/**
 * Splits the inside of an object into member ranges at `,` and line ends of its own depth. A line
 * end right after a `:` does not split, so a value may start on the next line.
 *
 * @param scan - The scan.
 * @param start - Index after the opening `{`.
 * @param end - Index of the closing `}`.
 * @returns The member ranges, untrimmed.
 * @example
 * ```ts
 * splitMembers(scan, open + 1, close);
 * ```
 */
function splitMembers(scan: Scan, start: number, end: number): [number, number][] {
  const ranges: [number, number][] = [];
  let nesting = 0;
  let from = start;
  let last = "";

  for (let index = start; index < end; index += 1) {
    const char = scan.text[index] ?? "";
    const isCode = scan.kinds[index] === CODE;

    if (isCode && OPENERS.has(char)) nesting += 1;
    else if (isCode && CLOSERS.has(char)) nesting -= 1;

    const splits = isCode && nesting === 0 && (char === "," || (char === "\n" && last !== ":"));
    if (splits) {
      ranges.push([from, index]);
      from = index + 1;
      last = "";
    } else if (isSignificant(scan, index)) {
      last = char;
    }
  }

  ranges.push([from, end]);
  return ranges;
}

/**
 * The index of the first code `:` at the depth of the member, or -1.
 *
 * @param scan - The scan.
 * @param start - First index of the member.
 * @param end - End index of the member.
 * @returns The colon index, or -1 for a shorthand or a spread.
 */
function memberColon(scan: Scan, start: number, end: number): number {
  let nesting = 0;

  for (let index = start; index < end; index += 1) {
    if (scan.kinds[index] !== CODE) continue;
    const char = scan.text[index] ?? "";
    if (OPENERS.has(char)) nesting += 1;
    else if (CLOSERS.has(char)) nesting -= 1;
    else if (char === ":" && nesting === 0) return index;
  }

  return -1;
}

/**
 * The name of a member key: an identifier, or a quoted key without its quotes.
 *
 * @param raw - The key as written.
 * @returns The key name.
 * @example
 * ```ts
 * keyName('"maxWidth"'); // "maxWidth"
 * ```
 */
function keyName(raw: string): string {
  const quote = raw[0];
  const isQuoted = raw.length >= 2 && (quote === '"' || quote === "'") && raw.endsWith(quote);

  return isQuoted ? raw.slice(1, -1) : raw;
}

/**
 * The field of one value: a number with its columns, or an other field.
 *
 * @param scan - The scan.
 * @param path - The field path.
 * @param start - First index of the trimmed value.
 * @param end - End index of the trimmed value.
 * @returns The field.
 * @example
 * ```ts
 * valueField(scan, "size", 1210, 1212); // { kind: "number", path: "size", value: 60, … }
 * ```
 */
function valueField(scan: Scan, path: string, start: number, end: number): StyleField {
  const raw = scan.text.slice(start, end);
  const line = lineOf(scan, start);

  if (!NUMBER_LITERAL.test(raw)) return { kind: "other", path, raw, line };

  const colStart = start - (scan.lineStarts[line - 1] ?? 0);
  return {
    kind: "number",
    path,
    value: Number(raw),
    raw,
    line,
    colStart,
    colEnd: colStart + raw.length
  };
}

/**
 * Reads the members of an object into fields: depth +1 as `name`, depth +2 as `name.sub`, deeper
 * objects and arrays as one other field of at most 40 characters.
 *
 * @param scan - The scan.
 * @param start - Index after the opening `{`.
 * @param end - Index of the closing `}`.
 * @param prefix - "" for the block, "shadow." for a nested object.
 * @param fields - Where the fields go, in source order.
 * @example
 * ```ts
 * readMembers(scan, open + 1, close, "", fields);
 * ```
 */
function readMembers(
  scan: Scan,
  start: number,
  end: number,
  prefix: string,
  fields: StyleField[]
): void {
  for (const [rangeStart, rangeEnd] of splitMembers(scan, start, end)) {
    const [from, to] = trimRange(scan, rangeStart, rangeEnd);
    if (from < to) readMember(scan, from, to, prefix, fields);
  }
}

/**
 * Reads one trimmed member `name: value`, a shorthand or a spread into fields.
 *
 * @param scan - The scan.
 * @param from - First index of the member.
 * @param to - End index of the member.
 * @param prefix - "" for the block, "shadow." for a nested object.
 * @param fields - Where the fields go.
 */
function readMember(
  scan: Scan,
  from: number,
  to: number,
  prefix: string,
  fields: StyleField[]
): void {
  const colon = memberColon(scan, from, to);
  const line = lineOf(scan, from);

  if (colon === -1) {
    const raw = scan.text.slice(from, to);
    fields.push({ kind: "other", path: `${prefix}${raw}`, raw, line });
    return;
  }

  const [keyStart, keyEnd] = trimRange(scan, from, colon);
  const path = `${prefix}${keyName(scan.text.slice(keyStart, keyEnd))}`;
  const [valueStart, valueEnd] = trimRange(scan, colon + 1, to);
  const opener = scan.text[valueStart];
  const isObject = opener === "{" && scan.partners[valueStart] === valueEnd - 1;

  if (isObject && prefix === "") {
    readMembers(scan, valueStart + 1, valueEnd - 1, `${path}.`, fields);
  } else if (opener === "{" || opener === "[") {
    const raw = scan.text.slice(valueStart, valueEnd).slice(0, DEEP_RAW_LIMIT);
    fields.push({ kind: "other", path, raw, line });
  } else {
    fields.push(valueField(scan, path, valueStart, valueEnd));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocks and colours
// ─────────────────────────────────────────────────────────────────────────────

/** A text-style table entry: `"ui.number": {`. */
const TEXT_BLOCK = /^\s*(["'])([\w.-]+)\1\s*:\s*\{/;

/** A layout style constant: `export const hudRow = defineStyle({`. */
const CONST_BLOCK = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*defineStyle\s*\(\s*\{/;

/** A colour constant: `const sky = "#aabbcc"` or `const cream = 0xff_f3_d6`. */
const COLOUR =
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(["'])#([\dA-Fa-f]{6})\2|0x([\dA-Fa-f_]+))/;

/** Hex digits of a 0x colour. */
const HEX_COLOUR = /^[\da-f]{6}$/;

/**
 * The block that starts on a line: its ref and the index of its opening `{` (a code brace).
 *
 * @param scan - The scan.
 * @param line - The line number.
 * @returns The start, or undefined when the line starts no block.
 * @example
 * ```ts
 * blockStart(scan, 72); // { ref: { kind: "text", key: "ui.number" }, open: 1180 }
 * ```
 */
function blockStart(
  scan: Scan,
  line: number
): { readonly ref: StyleBlockRef; readonly open: number } | undefined {
  const text = lineText(scan, line);
  const lineStart = scan.lineStarts[line - 1] ?? 0;
  const textMatch = TEXT_BLOCK.exec(text);
  const constMatch = textMatch ? undefined : CONST_BLOCK.exec(text);
  const match = textMatch ?? constMatch;

  if (!match) return undefined;

  const open = lineStart + match[0].length - 1;
  if (scan.kinds[open] !== CODE) return undefined;

  const ref: StyleBlockRef = textMatch
    ? { kind: "text", key: textMatch[2] ?? "" }
    : { kind: "const", name: constMatch?.[1] ?? "" };

  return { ref, open };
}

/**
 * The colour of a line, `[identifier, "#rrggbb"]`, or undefined.
 *
 * @param scan - The scan.
 * @param line - The line number.
 * @returns The colour entry.
 * @example
 * ```ts
 * colourOf(scan, 17); // ["cream", "#fff3d6"]
 * ```
 */
function colourOf(scan: Scan, line: number): [string, string] | undefined {
  const match = COLOUR.exec(lineText(scan, line));
  const lineStart = scan.lineStarts[line - 1] ?? 0;

  if (!match?.[1] || scan.kinds[lineStart + match[0].search(/\S/)] !== CODE) return undefined;

  const hex = (match[3] ?? match[4] ?? "").replaceAll("_", "").toLowerCase();
  return HEX_COLOUR.test(hex) ? [match[1], `#${hex}`] : undefined;
}

/**
 * Parses the style blocks and colour constants of a file.
 *
 * @param text - The file text.
 * @returns The style file, or `{ error: "parse", line }` when a block or the braces never close.
 * @example
 * ```ts
 * const file = parseStyleFile(text);
 * if (!isStyleEditError(file)) file.blocks.map(block => block.ref);
 * ```
 */
export function parseStyleFile(text: string): StyleFile | StyleEditError {
  const scan = scanText(text);
  const blocks: StyleBlock[] = [];
  const colours = new Map<string, string>();
  let line = 1;

  while (line <= scan.lineStarts.length) {
    const colour = colourOf(scan, line);
    if (colour) colours.set(colour[0], colour[1]);

    const start = blockStart(scan, line);
    const close = start === undefined ? -1 : (scan.partners[start.open] ?? -1);

    if (start === undefined) {
      line += 1;
    } else if (close === -1) {
      return { error: "parse", line };
    } else {
      const fields: StyleField[] = [];
      readMembers(scan, start.open + 1, close, "", fields);
      const endLine = lineOf(scan, close);
      blocks.push({ ref: start.ref, line, endLine, fields });
      line = endLine + 1;
    }
  }

  if (scan.unbalanced !== -1) return { error: "parse", line: lineOf(scan, scan.unbalanced) };

  const lineBreak = text.indexOf("\n");
  const eol = lineBreak > 0 && text[lineBreak - 1] === "\r" ? "\r\n" : "\n";

  return { blocks, colours, eol };
}

/**
 * The key or name of a block ref.
 *
 * @param ref - The block ref.
 * @returns `ref.key` for a text block, `ref.name` for a const block.
 * @example
 * ```ts
 * refKey({ kind: "const", name: "hudRow" }); // "hudRow"
 * ```
 */
function refKey(ref: StyleBlockRef): string {
  return ref.kind === "text" ? ref.key : ref.name;
}

/**
 * Finds one block by ref: `no-key` or `ambiguous` when not exactly one.
 *
 * @param file - A parsed style file.
 * @param ref - The block ref.
 * @returns The block, `{ error: "no-key", key }` or `{ error: "ambiguous", key, line }` (the
 * line of the second block).
 * @example
 * ```ts
 * findBlock(file, { kind: "text", key: "ui.number" }); // { ref, line: 72, endLine: 80, fields }
 * ```
 */
export function findBlock(file: StyleFile, ref: StyleBlockRef): StyleBlock | StyleEditError {
  const key = refKey(ref);
  const found = file.blocks.filter(
    block => block.ref.kind === ref.kind && refKey(block.ref) === key
  );
  const [first, second] = found;

  if (second) return { error: "ambiguous", key, line: second.line };
  return first ?? { error: "no-key", key };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounds, stepping and number format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a rule that is not integer-only.
 *
 * @param min - Lowest value.
 * @param max - Highest value.
 * @param step - Step of one press.
 * @param bigStep - Step with Shift.
 * @returns The rule.
 * @example
 * ```ts
 * rule(0, 1, 0.05, 0.1); // { min: 0, max: 1, step: 0.05, bigStep: 0.1, integer: false }
 * ```
 */
function rule(min: number, max: number, step: number, bigStep: number): FieldRule {
  return { min, max, step, bigStep, integer: false };
}

/** Bounds of the text-style (`TextStyle`) fields. */
const TEXT_RULES: ReadonlyMap<string, FieldRule> = new Map([
  ["size", rule(1, 512, 1, 10)],
  ["strokeWidth", rule(0, 64, 1, 5)],
  ["letterSpacing", rule(-50, 50, 0.5, 5)],
  ["wrap", rule(0, 4096, 1, 10)],
  ["shadow.dx", rule(-256, 256, 1, 10)],
  ["shadow.dy", rule(-256, 256, 1, 10)],
  ["shadow.alpha", rule(0, 1, 0.05, 0.1)]
]);

/** The four sides of a box, as nested paths. */
const SIDES = ["", ".top", ".right", ".bottom", ".left"];

/** Bounds of the layout-style (`Style`) fields. */
const CONST_RULES: ReadonlyMap<string, FieldRule> = new Map([
  ...["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"].map(
    (path): [string, FieldRule] => [path, rule(0, 8192, 1, 10)]
  ),
  ["gap", rule(0, 1024, 1, 10)],
  ...SIDES.map((side): [string, FieldRule] => [`padding${side}`, rule(0, 1024, 1, 10)]),
  ...SIDES.map((side): [string, FieldRule] => [`margin${side}`, rule(-1024, 1024, 1, 10)]),
  ...["left", "top", "right", "bottom"].map((path): [string, FieldRule] => [
    path,
    rule(-4096, 4096, 1, 10)
  ]),
  ["grow", rule(0, 64, 1, 1)],
  ["shrink", rule(0, 64, 1, 1)],
  ["aspect", rule(0.05, 20, 0.05, 0.5)],
  ["alpha", rule(0, 1, 0.05, 0.1)],
  ["zIndex", { min: -1000, max: 1000, step: 1, bigStep: 10, integer: true }]
]);

/**
 * The stepper rule of a field, or undefined (the field is then read-only).
 *
 * @param ref - The block ref.
 * @param path - The field path.
 * @returns The rule of the bounds table, or undefined.
 * @example
 * ```ts
 * fieldRule({ kind: "text", key: "ui.number" }, "size"); // { min: 1, max: 512, step: 1, bigStep: 10, integer: false }
 * ```
 */
export function fieldRule(ref: StyleBlockRef, path: string): FieldRule | undefined {
  return (ref.kind === "text" ? TEXT_RULES : CONST_RULES).get(path);
}

/**
 * Rounds to 2 decimals.
 *
 * @param value - A number.
 * @returns The number rounded to hundredths.
 * @example
 * ```ts
 * roundHundredths(0.6000000000000001); // 0.6
 * ```
 */
function roundHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The next stepper value: rounded to 2 decimals, clamped, integer when the rule says so.
 *
 * @param rule - The field rule.
 * @param value - The current value.
 * @param direction - 1 up, -1 down.
 * @param big - Shift held.
 * @returns The next value inside `[rule.min, rule.max]`.
 * @example
 * ```ts
 * stepValue(rule, 0.55, 1, false); // 0.6
 * ```
 */
export function stepValue(rule: FieldRule, value: number, direction: 1 | -1, big: boolean): number {
  const stepped = roundHundredths(value + direction * (big ? rule.bigStep : rule.step));
  const clamped = Math.min(rule.max, Math.max(rule.min, stepped));

  return rule.integer ? Math.round(clamped) : clamped;
}

/**
 * Prints a number: integers without decimals, else at most 2 decimals, trailing zeros trimmed.
 *
 * @param value - The number.
 * @returns The literal to write (`-0` prints `0`).
 * @example
 * ```ts
 * formatNumber(0.333); // "0.33"
 * ```
 */
export function formatNumber(value: number): string {
  const rounded = roundHundredths(value);

  if (Number.isInteger(rounded)) return String(rounded === 0 ? 0 : rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit and write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one number field an edit may change, or why not (edit rules 1–5).
 *
 * @param text - The file text.
 * @param target - What the card showed.
 * @param next - The new value.
 * @returns The field, or the refusal.
 * @example
 * ```ts
 * editableField(text, target, 64); // { kind: "number", path: "size", … }
 * ```
 */
function editableField(
  text: string,
  target: EditTarget,
  next: number
): NumberField | StyleEditError {
  const file = parseStyleFile(text);
  if (isStyleEditError(file)) return file;

  const block = findBlock(file, target.ref);
  if (isStyleEditError(block)) return block;

  const key = refKey(target.ref);
  const { path } = target;
  const [field, twice] = block.fields.filter(item => item.path === path);

  if (!field) return { error: "changed-on-disk", key, path };
  if (twice) return { error: "ambiguous", key, path, line: twice.line };
  if (field.kind === "other") return { error: "not-literal", key, path, line: field.line };
  if (field.raw !== target.raw) return { error: "changed-on-disk", key, path, line: field.line };

  const bounds = fieldRule(target.ref, path);
  if (!bounds) return { error: "read-only", key, path, line: field.line };

  const inRange = Number.isFinite(next) && next >= bounds.min && next <= bounds.max;
  return inRange ? field : { error: "out-of-range", key, path, line: field.line };
}

/**
 * The index of the first character of a 1-based line.
 *
 * @param text - The text.
 * @param line - The line number.
 * @returns The index.
 * @example
 * ```ts
 * lineStartOf("a\nb", 2); // 2
 * ```
 */
function lineStartOf(text: string, line: number): number {
  let start = 0;
  for (let current = 1; current < line; current += 1) start = text.indexOf("\n", start) + 1;
  return start;
}

/**
 * True when the edited text holds the new literal and every other line is unchanged (rule 7).
 *
 * @param before - The text before the edit.
 * @param after - The edited text.
 * @param target - What the card showed.
 * @param raw - The literal that was written.
 * @param line - The edited line.
 * @returns Whether the edit is exactly the one literal.
 */
function isCleanEdit(
  before: string,
  after: string,
  target: EditTarget,
  raw: string,
  line: number
): boolean {
  const file = parseStyleFile(after);
  const block = isStyleEditError(file) ? file : findBlock(file, target.ref);
  if (isStyleEditError(block)) return false;

  const fields = block.fields.filter(item => item.path === target.path);
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const others = oldLines.every((text, index) => index === line - 1 || text === newLines[index]);

  return (
    fields.length === 1 && fields[0]?.raw === raw && oldLines.length === newLines.length && others
  );
}

/**
 * Replaces exactly one numeric literal; every other byte stays.
 *
 * @param text - The current file text.
 * @param target - What the card showed.
 * @param next - The new value.
 * @returns The edited text and its line, or the refusal (`parse`, `no-key`, `ambiguous`,
 * `not-literal`, `changed-on-disk`, `read-only`, `out-of-range`).
 * @example
 * ```ts
 * editNumber(text, { ref: { kind: "text", key: "ui.number" }, path: "size", raw: "60" }, 64);
 * // { text: "…    size: 64,…", line: 74 }
 * ```
 */
export function editNumber(
  text: string,
  target: EditTarget,
  next: number
): EditDone | StyleEditError {
  const field = editableField(text, target, next);
  if (isStyleEditError(field)) return field;

  const lineStart = lineStartOf(text, field.line);
  const raw = formatNumber(next);
  const head = text.slice(0, lineStart + field.colStart);
  const edited = `${head}${raw}${text.slice(lineStart + field.colEnd)}`;

  if (!isCleanEdit(text, edited, target, raw, field.line)) {
    return { error: "parse", line: field.line };
  }
  return { text: edited, line: field.line };
}

/**
 * True for a rejection that means the file is missing (-32601) or outside the sandbox (-32004).
 *
 * @param error - A rejection of the files client.
 * @returns Whether the edit reports `no-file`.
 * @example
 * ```ts
 * isNoFile(wireError(-32_004, "forbidden path")); // true
 * ```
 */
function isNoFile(error: unknown): boolean {
  return (
    isWireError(error) &&
    (error.code === errorCode.unknownMethod || error.code === errorCode.forbiddenPath)
  );
}

/**
 * True for a version-conflict rejection (-32005).
 *
 * @param error - A rejection of the files client.
 * @returns Whether the file changed since it was read.
 * @example
 * ```ts
 * isConflict(wireError(-32_005, "version conflict")); // true
 * ```
 */
function isConflict(error: unknown): boolean {
  return isWireError(error) && error.code === errorCode.versionConflict;
}

/**
 * Reads and parses a style file; a missing or forbidden file → `no-file`.
 *
 * @param files - The files client.
 * @param path - The style file path.
 * @returns The text, version and parsed file, or `no-file` / `parse`; other rejections propagate.
 * @example
 * ```ts
 * const loaded = await loadStyleFile(tools.files, "features/ui/styles.ts");
 * if (isStyleEditError(loaded)) return showReason(loaded);
 * ```
 */
export async function loadStyleFile(
  files: StyleFiles,
  path: string
): Promise<LoadedStyleFile | StyleEditError> {
  let read: FileText;

  try {
    read = await files.read(path);
  } catch (error) {
    if (isNoFile(error)) return { error: "no-file", path };
    throw error;
  }

  const file = parseStyleFile(read.text);
  return isStyleEditError(file) ? file : { text: read.text, version: read.version, file };
}

/**
 * Writes an edit with a version; a conflict comes back as undefined, a missing file as `no-file`.
 *
 * @param files - The files client.
 * @param path - The style file path.
 * @param edited - The edited text and line.
 * @param version - The version the edit was made from.
 * @returns The write, `no-file`, or undefined on a version conflict; other rejections propagate.
 */
async function tryWrite(
  files: StyleFiles,
  path: string,
  edited: EditDone,
  version: string
): Promise<WriteDone | StyleEditError | undefined> {
  try {
    const result = await files.write(path, edited.text, version);
    return {
      ok: true,
      text: edited.text,
      line: edited.line,
      version: result.version,
      bytes: result.bytes
    };
  } catch (error) {
    if (isConflict(error)) return undefined;
    if (isNoFile(error)) return { error: "no-file", path };
    throw error;
  }
}

/**
 * The one retry after a conflict: read the file again and write when the literal is unchanged.
 *
 * @param files - The files client.
 * @param path - The style file path.
 * @param target - What the card showed.
 * @param next - The new value.
 * @returns The write, `no-file` or `changed-on-disk`.
 */
async function retryWrite(
  files: StyleFiles,
  path: string,
  target: EditTarget,
  next: number
): Promise<WriteDone | StyleEditError> {
  let fresh: FileText;

  try {
    fresh = await files.read(path);
  } catch (error) {
    if (isNoFile(error)) return { error: "no-file", path };
    throw error;
  }

  const edited = editNumber(fresh.text, target, next);
  if (isStyleEditError(edited)) return { error: "changed-on-disk" };

  return (await tryWrite(files, path, edited, fresh.version)) ?? { error: "changed-on-disk" };
}

/**
 * Edits and writes with the read version; one retry on -32005 when the literal is unchanged.
 *
 * @param files - The files client.
 * @param path - The style file path.
 * @param current - The text and version the card was built from.
 * @param target - What the card showed.
 * @param next - The new value.
 * @returns `{ ok: true, text, line, version, bytes }`, or the refusal; nothing is written on a
 * refusal. Rejections other than -32005 and -32004 propagate.
 * @example
 * ```ts
 * await writeNumber(tools.files, "features/ui/styles.ts", loaded, target, 64);
 * // { ok: true, line: 74, version: "9c1e…", … }
 * ```
 */
export async function writeNumber(
  files: StyleFiles,
  path: string,
  current: FileText,
  target: EditTarget,
  next: number
): Promise<WriteDone | StyleEditError> {
  const edited = editNumber(current.text, target, next);
  if (isStyleEditError(edited)) return edited;

  return (
    (await tryWrite(files, path, edited, current.version)) ?? retryWrite(files, path, target, next)
  );
}

/** Every edit error code. */
const CODES: ReadonlySet<unknown> = new Set<StyleEditCode>([
  "no-file",
  "parse",
  "no-key",
  "ambiguous",
  "not-literal",
  "read-only",
  "changed-on-disk",
  "out-of-range"
]);

/**
 * True for a StyleEditError.
 *
 * @param value - Anything.
 * @returns Whether `value` is an object whose `error` is one of the eight codes.
 * @example
 * ```ts
 * if (isStyleEditError(loaded)) return showReason(loaded);
 * ```
 */
export function isStyleEditError(value: unknown): value is StyleEditError {
  return typeof value === "object" && value !== null && "error" in value && CODES.has(value.error);
}
