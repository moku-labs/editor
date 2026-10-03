/**
 * @file flowView notes module — types: note files, the editor draft, the create input, state, the
 * public notes api and the internal notes actions. The codec is panels/shared/notes (R4).
 */
import type { Note, NoteParseError } from "../../panels/shared/notes";
import type { NoteAnchor } from "../types";

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
  /** Free note position in world units (viewport centre). */
  anchor: { x: number; y: number } | undefined;
};

/**
 * The input of notes.create.
 *
 * @example
 * ```ts
 * const input: NoteInput = { title: "First wood 4", from: { node: "board/merge", outcome: "done" } };
 * ```
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
 * The notes namespace of the api (`app.flowView.notes`).
 */
export type NotesApi = {
  /**
   * The parsed note files, newest first (at most 200).
   *
   * @returns A copy of the list.
   * @example
   * ```ts
   * app.flowView.notes.list()[0]?.path; // ".moku/notes/2026-09-24-first-top-item.md"
   * ```
   */
  list(): readonly NoteFile[];

  /**
   * Opens the note editor (D5). The `workspace:new-note` hook calls it with `{ captures, from }`.
   *
   * @param draft - Prefilled fields; omitted = a free note.
   * @example
   * ```ts
   * app.flowView.notes.edit({ from: { node: "board/merge", outcome: "done" } }); // "On board/merge · done"
   * ```
   */
  edit(draft?: Partial<NoteDraft>): void;

  /**
   * Writes a new note file `<notesDir>/<date>-<slug>.md` with the contract front matter and
   * toasts "✓ Note saved · <path>" (M12).
   *
   * @param input - Title and optional body, origin, target and captures.
   * @returns The written note file.
   * @example
   * ```ts
   * await app.flowView.notes.create({ title: "First wood 4", body: "…", from: { node: "board/merge", outcome: "done" } });
   * // { path: ".moku/notes/2026-09-24-first-wood-4.md", note: { status: "idea", to: "board/awaitIntent", … } }
   * ```
   */
  create(input: NoteInput): Promise<NoteFile>;

  /**
   * Appends capture paths to a note's front matter (version checked, one retry) and toasts
   * "✓ Attached to <title>".
   *
   * @param path - The note file.
   * @param captures - Capture paths (PNGs or series index.json).
   * @returns The rewritten note file.
   * @throws {Error} When the note's front matter is not readable (it is never rewritten).
   * @example
   * ```ts
   * await app.flowView.notes.attach(".moku/notes/2026-09-24-first-top-item.md", [".moku/captures/2026-09-24-1012-board.png"]);
   * ```
   */
  attach(path: string, captures: readonly string[]): Promise<NoteFile>;
};

/**
 * The notes actions: the api plus what the components and the other modules call.
 */
export type NotesActions = NotesApi & {
  /**
   * Lists and reads the note files (newest name first, at most 200; an unreadable file is logged
   * and left out), then lays out again.
   */
  load(): Promise<void>;
  /** Where each readable note sits on the canvas. */
  anchors(): readonly NoteAnchor[];
  /** Patches the open draft. */
  update(patch: Partial<NoteDraft>): void;
  /**
   * Saves the open draft as a new note (a free note is pinned at its anchor in the root flow);
   * resolves undefined when nothing is open or the title is blank.
   */
  save(): Promise<NoteFile | undefined>;
  /** Closes the editor; false when it was not open (Esc layer noteEditor). */
  close(): boolean;
  /** The path the open draft will be saved to. */
  draftPath(): string;
};
