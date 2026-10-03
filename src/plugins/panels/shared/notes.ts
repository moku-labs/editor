/**
 * @file Shared view module — the one codec for `.moku/notes/<date>-<slug>.md` front matter
 * (title, from { node, outcome }, to, status, captures[], created). File naming stays in flowView.
 */

/**
 * The statuses the UI offers; any string is kept.
 */
export const NOTE_STATUSES = ["idea", "todo", "done"] as const;

/**
 * Where a note comes from: a node and, optionally, one of its outcomes.
 */
export type NoteFrom = { readonly node: string; readonly outcome?: string };

/**
 * A parsed note.
 */
export type Note = {
  readonly title: string;
  /** undefined = free note. */
  readonly from: NoteFrom | undefined;
  /** Target node id of that outcome. */
  readonly to: string | undefined;
  /** "idea" by default. */
  readonly status: string;
  /** Relative paths: PNGs or series index.json. */
  readonly captures: readonly string[];
  /** "2026-09-24". */
  readonly created: string | undefined;
  /** Markdown after the front matter, verbatim. */
  readonly body: string;
  /** Unknown front-matter lines, verbatim, in order. */
  readonly extra: readonly string[];
  readonly eol: "\n" | "\r\n";
};

/**
 * A front matter the codec cannot read (the file is never rewritten).
 */
export type NoteParseError = {
  readonly error: "front-matter";
  readonly line: number;
  readonly reason: string;
};

/**
 * The input of newNote.
 */
export type NewNote = {
  readonly title: string;
  readonly body?: string;
  readonly from?: NoteFrom;
  readonly to?: string;
  readonly status?: string;
  readonly captures?: readonly string[];
  readonly created?: string;
};

/**
 * One line of the file: its text without the line break and the index after the break.
 */
type Line = { readonly text: string; readonly next: number };

/**
 * A front-matter line with its 1-based line number.
 */
type NumberedLine = { readonly text: string; readonly line: number };

/**
 * One top-level key: its line, the text after the colon and the non-blank lines under it.
 */
type Entry = {
  readonly key: string;
  readonly value: string;
  readonly line: number;
  readonly text: string;
  readonly children: readonly NumberedLine[];
};

/**
 * The scalar keys of the front matter.
 */
type ScalarKey = "title" | "to" | "status" | "created";

/**
 * What the front matter said so far.
 */
type Draft = {
  title?: string;
  from?: NoteFrom;
  to?: string;
  status?: string;
  captures?: string[];
  created?: string;
  readonly extra: string[];
  readonly seen: Set<string>;
};

/** The default status of a note. */
const DEFAULT_STATUS = "idea";

/** The title of a note that has none. */
const UNTITLED = "Untitled";

/** The fence line around the front matter. */
const FENCE = "---";

/** A top-level key at column 0: `title: …`. */
const KEY_LINE = /^([A-Za-z_][\w-]*):(.*)$/;

/** A line under `from:`: two or more spaces, `node:` or `outcome:`. */
const FROM_LINE = /^ {2,}(node|outcome):(.*)$/;

/** Leading `#` and spaces of a Markdown heading. */
const HEADING_MARKS = /^[\s#]+/;

/** Where a plain scalar's comment starts. */
const COMMENT = /(?:^|\s)#/;

/** Characters that make a scalar need quotes. */
const SPECIAL = /[\n\r!"#%&'*,:>@[\]`{|}]/;

/** Plain words YAML reads as something other than text. */
const RESERVED = /^(?:true|false|null|~|yes|no|on|off)$/i;

/**
 * Builds a front-matter error.
 *
 * @param line - The 1-based line.
 * @param reason - What is wrong.
 * @returns The error value.
 * @example
 * ```ts
 * failure(3, "duplicate key title");
 * ```
 */
function failure(line: number, reason: string): NoteParseError {
  return { error: "front-matter", line, reason };
}

/**
 * Splits a text into lines, keeping where each line break ends.
 *
 * @param text - The text.
 * @returns The lines (`\r` of a CRLF removed).
 * @example
 * ```ts
 * splitLines("a\r\nb"); // [{ text: "a", next: 3 }, { text: "b", next: 5 }]
 * ```
 */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  while (start <= text.length) {
    const lineBreak = text.indexOf("\n", start);
    const end = lineBreak === -1 ? text.length : lineBreak;
    const raw = text.slice(start, end);
    lines.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, next: end + 1 });
    start = end + 1;
  }

  return lines;
}

/**
 * The title of a text: its first non-empty line without leading `#` and spaces.
 *
 * @param text - Markdown.
 * @returns The title, or "Untitled".
 * @example
 * ```ts
 * titleOf("\n# A loose idea"); // "A loose idea"
 * ```
 */
function titleOf(text: string): string {
  const first = text.split(/\r?\n/).find(line => line.trim() !== "");
  const title = first?.replace(HEADING_MARKS, "").trim() ?? "";

  return title === "" ? UNTITLED : title;
}

/**
 * Parses a double-quoted scalar with JSON rules.
 *
 * @param raw - The scalar, starting with `"`.
 * @returns The string, or undefined when it is not one JSON string.
 * @example
 * ```ts
 * jsonString('"a: b"'); // "a: b"
 * ```
 */
function jsonString(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads one scalar: `"…"` with JSON rules, `'…'` with `''` for `'`, plain trimmed and cut before a
 * ` #` comment.
 *
 * @param raw - The value text after the colon or the dash.
 * @param line - Its line, for the error.
 * @returns The string, or the error.
 * @example
 * ```ts
 * readScalar(" 'it''s' ", 2); // "it's"
 * ```
 */
function readScalar(raw: string, line: number): string | NoteParseError {
  const value = raw.trim();

  if (value.startsWith('"')) return jsonString(value) ?? failure(line, "invalid quoted value");

  if (value.startsWith("'")) {
    const isClosed = value.length >= 2 && value.endsWith("'");
    return isClosed ? value.slice(1, -1).replaceAll("''", "'") : failure(line, "unclosed quote");
  }

  const cut = value.search(COMMENT);
  return (cut === -1 ? value : value.slice(0, cut)).trim();
}

/**
 * Reads the `node:` and `outcome:` lines under `from:`.
 *
 * @param children - The lines under the key.
 * @param line - The line of `from:`.
 * @returns The origin, or the error.
 * @example
 * ```ts
 * readFrom([{ text: "  node: board/merge", line: 3 }], 2); // { node: "board/merge" }
 * ```
 */
function readFrom(children: readonly NumberedLine[], line: number): NoteFrom | NoteParseError {
  const parts = new Map<string, string>();

  for (const child of children) {
    const match = FROM_LINE.exec(child.text);
    const name = match?.[1];
    if (name === undefined) return failure(child.line, "from takes node and outcome lines");
    if (parts.has(name)) return failure(child.line, `duplicate ${name}`);
    const value = readScalar(match?.[2] ?? "", child.line);
    if (typeof value !== "string") return value;
    parts.set(name, value);
  }

  const node = parts.get("node");
  const outcome = parts.get("outcome");
  if (node === undefined) return failure(line, "from needs a node");

  return outcome === undefined ? { node } : { node, outcome };
}

/**
 * The text of a `- <item>` line (indented or not), or undefined for any other line.
 *
 * @param text - A line under `captures:`.
 * @returns The item text after the dash and its space.
 * @example
 * ```ts
 * listItem("  - a.png"); // "a.png"
 * ```
 */
function listItem(text: string): string | undefined {
  const item = text.trimStart();
  const isItem = item.startsWith("-") && (item.charAt(1) === " " || item.charAt(1) === "\t");

  return isItem ? item.slice(2) : undefined;
}

/**
 * Reads the `- <path>` lines under `captures:`.
 *
 * @param children - The lines under the key.
 * @returns The paths, or the error.
 * @example
 * ```ts
 * readCaptures([{ text: "  - a.png", line: 4 }]); // ["a.png"]
 * ```
 */
function readCaptures(children: readonly NumberedLine[]): string[] | NoteParseError {
  const captures: string[] = [];

  for (const child of children) {
    const item = listItem(child.text);
    if (item === undefined) return failure(child.line, "captures takes - lines");
    const value = readScalar(item, child.line);
    if (typeof value !== "string") return value;
    captures.push(value);
  }

  return captures;
}

/**
 * Reads a scalar key: one value on its own line, nothing under it.
 *
 * @param draft - What the front matter said so far.
 * @param key - The scalar key.
 * @param entry - The key line and the lines under it.
 * @returns The error, or undefined when read.
 * @example
 * ```ts
 * readScalarKey(draft, "title", { key: "title", value: " T", line: 2, text: "title: T", children: [] });
 * ```
 */
function readScalarKey(draft: Draft, key: ScalarKey, entry: Entry): NoteParseError | undefined {
  const [child] = entry.children;
  if (child) return failure(child.line, `${key} takes one value`);
  if (entry.value.trim() === "") return failure(entry.line, `${key} needs a value`);

  const value = readScalar(entry.value, entry.line);
  if (typeof value !== "string") return value;
  draft[key] = value;
  return undefined;
}

/**
 * Reads `captures: []` or `captures:` with `- ` lines.
 *
 * @param draft - What the front matter said so far.
 * @param entry - The key line and the lines under it.
 * @returns The error, or undefined when read.
 * @example
 * ```ts
 * readCapturesKey(draft, { key: "captures", value: " []", line: 5, text: "captures: []", children: [] });
 * ```
 */
function readCapturesKey(draft: Draft, entry: Entry): NoteParseError | undefined {
  const inline = entry.value.trim();
  if (inline !== "" && (inline !== "[]" || entry.children.length > 0)) {
    return failure(entry.line, "captures takes [] or - lines");
  }

  const captures = readCaptures(entry.children);
  if (!Array.isArray(captures)) return captures;
  draft.captures = captures;
  return undefined;
}

/**
 * Reads `from:` with its `node:` and `outcome:` lines.
 *
 * @param draft - What the front matter said so far.
 * @param entry - The key line and the lines under it.
 * @returns The error, or undefined when read.
 * @example
 * ```ts
 * readFromKey(draft, { key: "from", value: "", line: 3, text: "from:", children });
 * ```
 */
function readFromKey(draft: Draft, entry: Entry): NoteParseError | undefined {
  if (entry.value.trim() !== "") return failure(entry.line, "from takes node and outcome lines");

  const from = readFrom(entry.children, entry.line);
  if ("error" in from) return from;
  draft.from = from;
  return undefined;
}

/**
 * True for `title`, `to`, `status` and `created`.
 *
 * @param key - A front-matter key.
 * @returns Whether the key takes one scalar.
 * @example
 * ```ts
 * isScalarKey("status"); // true
 * ```
 */
function isScalarKey(key: string): key is ScalarKey {
  return key === "title" || key === "to" || key === "status" || key === "created";
}

/**
 * Reads one top-level key and the lines under it into the draft; an unknown key goes to `extra`.
 *
 * @param draft - What the front matter said so far.
 * @param entry - The key line and the lines under it.
 * @returns The error, or undefined when read.
 * @example
 * ```ts
 * readEntry(draft, { key: "status", value: " done", line: 7, text: "status: done", children: [] });
 * ```
 */
function readEntry(draft: Draft, entry: Entry): NoteParseError | undefined {
  const { key } = entry;

  if (key !== "from" && key !== "captures" && !isScalarKey(key)) {
    draft.extra.push(entry.text, ...entry.children.map(child => child.text));
    return undefined;
  }
  if (draft.seen.has(key)) return failure(entry.line, `duplicate key ${key}`);
  draft.seen.add(key);

  if (key === "from") return readFromKey(draft, entry);
  if (key === "captures") return readCapturesKey(draft, entry);
  return readScalarKey(draft, key, entry);
}

/**
 * True for a line that belongs to the key above it: blank, indented or a `- ` item.
 *
 * @param text - A front-matter line.
 * @returns Whether the line is a child line.
 * @example
 * ```ts
 * isChildLine("  - a.png"); // true
 * ```
 */
function isChildLine(text: string): boolean {
  return text.trim() === "" || /^[\s-]/.test(text);
}

/**
 * Collects the non-blank child lines that follow a key.
 *
 * @param lines - The front-matter lines.
 * @param start - Index of the first line after the key.
 * @returns The children and the index of the next top-level line.
 * @example
 * ```ts
 * childrenOf(["from:", "  node: a", "to: b"], 1); // { children: [{ text: "  node: a", line: 3 }], end: 2 }
 * ```
 */
function childrenOf(
  lines: readonly string[],
  start: number
): { readonly children: NumberedLine[]; readonly end: number } {
  const children: NumberedLine[] = [];
  let end = start;

  while (end < lines.length && isChildLine(lines[end] ?? "")) {
    const text = lines[end] ?? "";
    if (text.trim() !== "") children.push({ text, line: end + 2 });
    end += 1;
  }

  return { children, end };
}

/**
 * Reads the front-matter lines between the fences.
 *
 * @param lines - The lines between the two `---` (the first is line 2 of the file).
 * @returns The draft, or the error.
 * @example
 * ```ts
 * readFrontMatter(["title: T", "status: done"]);
 * ```
 */
function readFrontMatter(lines: readonly string[]): Draft | NoteParseError {
  const draft: Draft = { extra: [], seen: new Set() };
  let index = 0;

  while (index < lines.length) {
    const text = lines[index] ?? "";
    const line = index + 2;

    if (text.trim() === "" || text.startsWith("#")) {
      if (text.startsWith("#")) draft.extra.push(text);
      index += 1;
      continue;
    }

    const match = KEY_LINE.exec(text);
    if (!match) return failure(line, "expected a key");

    const { children, end } = childrenOf(lines, index + 1);
    const entry = { key: match[1] ?? "", value: match[2] ?? "", line, text, children };
    const problem = readEntry(draft, entry);
    if (problem) return problem;
    index = end;
  }

  return draft;
}

/**
 * Parses a note file.
 *
 * @param text - The file text (a leading BOM is dropped; the EOL comes from the first line break).
 * @returns The note, or `{ error: "front-matter", line, reason }` when the front matter is not
 * readable.
 * @example
 * ```ts
 * const note = parseNote(text);
 * if (isNoteParseError(note)) return showUnreadable(note);
 * ```
 */
export function parseNote(text: string): Note | NoteParseError {
  const clean = text.startsWith("﻿") ? text.slice(1) : text;
  const lineBreak = clean.indexOf("\n");
  const eol = lineBreak > 0 && clean[lineBreak - 1] === "\r" ? "\r\n" : "\n";
  const lines = splitLines(clean);

  if (lines[0]?.text !== FENCE) {
    return { ...newNote({ title: titleOf(clean), body: clean }), eol };
  }

  const close = lines.findIndex((line, index) => index > 0 && line.text === FENCE);
  if (close === -1) return failure(1, "no closing ---");

  const body = clean.slice(lines[close]?.next ?? clean.length);
  const draft = readFrontMatter(lines.slice(1, close).map(line => line.text));
  if ("error" in draft) return draft;

  return {
    title: draft.title ?? titleOf(body),
    from: draft.from,
    to: draft.to,
    status: draft.status ?? DEFAULT_STATUS,
    captures: draft.captures ?? [],
    created: draft.created,
    body,
    extra: draft.extra,
    eol
  };
}

/**
 * True when a scalar reads back as the same text without quotes.
 *
 * @param value - The scalar.
 * @returns Whether it may be written plain.
 * @example
 * ```ts
 * isPlain("board/merge"); // true
 * isPlain("a: b");        // false
 * ```
 */
function isPlain(value: string): boolean {
  return (
    value !== "" &&
    value === value.trim() &&
    !SPECIAL.test(value) &&
    !value.startsWith("-") &&
    !value.startsWith("?") &&
    !RESERVED.test(value) &&
    Number.isNaN(Number(value))
  );
}

/**
 * Writes a scalar plain when it reads back the same, else with JSON quotes.
 *
 * @param value - The scalar.
 * @returns The text after `key: `.
 * @example
 * ```ts
 * scalar("First wood 4: show a 'new item' popup"); // "\"First wood 4: show a 'new item' popup\""
 * ```
 */
function scalar(value: string): string {
  return isPlain(value) ? value : JSON.stringify(value);
}

/**
 * Formats a note in canonical form (`formatNote(parseNote(t)) === t` for every file it wrote).
 *
 * @param note - The note.
 * @returns The file text: front matter in the fixed key order, then the body verbatim.
 * @example
 * ```ts
 * await files.write(path, formatNote(note), version);
 * ```
 */
export function formatNote(note: Note): string {
  const lines = [FENCE, `title: ${scalar(note.title)}`];

  if (note.from) {
    lines.push("from:", `  node: ${scalar(note.from.node)}`);
    if (note.from.outcome !== undefined) lines.push(`  outcome: ${scalar(note.from.outcome)}`);
  }
  if (note.to !== undefined) lines.push(`to: ${scalar(note.to)}`);
  lines.push(`status: ${scalar(note.status)}`);

  if (note.captures.length === 0) lines.push("captures: []");
  else lines.push("captures:", ...note.captures.map(path => `  - ${scalar(path)}`));

  if (note.created !== undefined) lines.push(`created: ${scalar(note.created)}`);
  lines.push(...note.extra, FENCE);

  return `${lines.join(note.eol)}${note.eol}${note.body}`;
}

/**
 * A new note with defaults: status "idea", captures [], extra [], eol "\n".
 *
 * @param input - Title and optional fields.
 * @returns The note, ready for formatNote.
 * @example
 * ```ts
 * newNote({ title: "First wood 4", from: { node: "board/merge", outcome: "done" } });
 * ```
 */
export function newNote(input: NewNote): Note {
  const { from } = input;

  return {
    title: input.title,
    from: from === undefined ? undefined : { ...from },
    to: input.to,
    status: input.status ?? DEFAULT_STATUS,
    captures: [...(input.captures ?? [])],
    created: input.created,
    body: input.body ?? "",
    extra: [],
    eol: "\n"
  };
}

/**
 * Appends the capture paths not already present, order kept.
 *
 * @param note - The note.
 * @param paths - Capture paths.
 * @returns A new note; the given one is not changed.
 * @example
 * ```ts
 * addCaptures(note, [".moku/captures/2026-09-24-1012-board.png"]);
 * ```
 */
export function addCaptures(note: Note, paths: readonly string[]): Note {
  const captures = [...note.captures];

  for (const path of paths) {
    if (!captures.includes(path)) captures.push(path);
  }

  return { ...note, captures };
}

/**
 * True for a NoteParseError.
 *
 * @param value - Anything.
 * @returns Whether `value` is `{ error: "front-matter", line, reason }`.
 * @example
 * ```ts
 * if (isNoteParseError(note)) return showUnreadable(note);
 * ```
 */
export function isNoteParseError(value: unknown): value is NoteParseError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    value.error === "front-matter" &&
    "line" in value &&
    typeof value.line === "number" &&
    "reason" in value &&
    typeof value.reason === "string"
  );
}
