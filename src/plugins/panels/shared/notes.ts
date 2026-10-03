/**
 * @file Shared view module — the one codec for `.moku/notes/<date>-<slug>.md` front matter
 * (title, from { node, outcome }, to, status, captures[], created). File naming stays in flowView.
 */

/**
 * The statuses the UI offers; any string is kept.
 */
export const NOTE_STATUSES = ["idea", "todo", "done"] as const;

/**
 * A parsed note.
 */
export type Note = {
  readonly title: string;
  /** undefined = free note. */
  readonly from: { readonly node: string; readonly outcome?: string } | undefined;
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
  readonly from?: { readonly node: string; readonly outcome?: string };
  readonly to?: string;
  readonly status?: string;
  readonly captures?: readonly string[];
  readonly created?: string;
};

/**
 * Parses a note file.
 *
 * @param _text - The file text.
 * @example
 * ```ts
 * const note = parseNote(text);
 * ```
 */
export function parseNote(_text: string): Note | NoteParseError {
  throw new Error("not implemented");
}

/**
 * Formats a note in canonical form (`formatNote(parseNote(t)) === t` for every file it wrote).
 *
 * @param _note - The note.
 * @example
 * ```ts
 * await files.write(path, formatNote(note), version);
 * ```
 */
export function formatNote(_note: Note): string {
  throw new Error("not implemented");
}

/**
 * A new note with defaults: status "idea", captures [], extra [], eol "\n".
 *
 * @param _input - Title and optional fields.
 * @example
 * ```ts
 * newNote({ title: "First wood 4", from: { node: "board/merge", outcome: "done" } });
 * ```
 */
export function newNote(_input: NewNote): Note {
  throw new Error("not implemented");
}

/**
 * Appends the capture paths not already present, order kept.
 *
 * @param _note - The note.
 * @param _paths - Capture paths.
 * @example
 * ```ts
 * addCaptures(note, [".moku/captures/2026-09-24-1012-board.png"]);
 * ```
 */
export function addCaptures(_note: Note, _paths: readonly string[]): Note {
  throw new Error("not implemented");
}

/**
 * True for a NoteParseError.
 *
 * @param _value - Anything.
 * @example
 * ```ts
 * if (isNoteParseError(note)) return showUnreadable(note);
 * ```
 */
export function isNoteParseError(_value: unknown): _value is NoteParseError {
  throw new Error("not implemented");
}
