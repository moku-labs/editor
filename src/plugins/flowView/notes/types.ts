/**
 * @file flowView notes module — types: note files, the editor draft, the create input, state and
 * the notes api. The codec is panels/shared/notes (R4).
 */
import type { Note, NoteParseError } from "../../panels/shared/notes";

/**
 * One note file under notesDir.
 */
export type NoteFile = {
  readonly path: string;
  readonly version: string;
  /** undefined when the front matter is not readable (the file is never rewritten). */
  readonly note: Note | undefined;
  readonly error: NoteParseError | undefined;
};

/**
 * The note editor (D5) draft.
 */
export type NoteDraft = {
  title: string;
  body: string;
  from: { node: string; outcome?: string } | undefined;
  captures: readonly string[];
  /** Free note position (viewport centre). */
  anchor: { x: number; y: number } | undefined;
};

/**
 * The input of notes.create.
 */
export type NoteInput = {
  readonly title: string;
  readonly body?: string;
  readonly from?: { readonly node: string; readonly outcome?: string };
  readonly to?: string;
  readonly captures?: readonly string[];
};

/**
 * Notes module state.
 */
export type NotesState = { files: NoteFile[]; loaded: boolean; editor: NoteDraft | undefined };

/**
 * The notes namespace of the api.
 */
export type NotesApi = {
  /** Parsed note files, newest first. */
  list(): readonly NoteFile[];
  /** Open the note editor (D5). */
  edit(draft?: Partial<NoteDraft>): void;
  /** Write a new note file; toast. */
  create(input: NoteInput): Promise<NoteFile>;
  /** Append capture paths to a note's front matter; toast. */
  attach(path: string, captures: readonly string[]): Promise<NoteFile>;
};
