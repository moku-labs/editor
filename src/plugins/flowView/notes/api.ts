/**
 * @file flowView notes module — the notes actions: list, the note editor (D5), create and attach
 * through the shared codec (panels/shared/notes, R4), loading the note files and their anchors on
 * the canvas. Every write toasts the file (M12); an unreadable note is never rewritten.
 */
import type { NewNote } from "../../panels/shared/notes";
import {
  addCaptures,
  formatNote,
  isNoteParseError,
  newNote,
  parseNote
} from "../../panels/shared/notes";
import { errorCode, isWireError } from "../../registry/protocol";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, GraphJson, NoteAnchor } from "../types";
import { dateStamp, noteFileName } from "./slug";
import type { NoteDraft, NoteFile, NoteInput, NotesActions } from "./types";

/**
 * Most note files read.
 */
const MAX_NOTES = 200;

/**
 * How often `attach` reads and writes again after a version conflict before it throws.
 */
const ATTACH_RETRIES = 1;

/**
 * The file name of a path.
 *
 * @param path - A path.
 * @returns The part after the last "/".
 * @example
 * ```ts
 * baseName(".moku/notes/a.md"); // "a.md"
 * ```
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The flow of a node id.
 *
 * @param id - "<flow>/<node>".
 * @returns The flow.
 * @example
 * ```ts
 * flowOf("board/merge"); // "board"
 * ```
 */
function flowOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/**
 * The target node id of an outcome, for the `to` key; none for an exit or a missing edge.
 *
 * @param graph - The graph.
 * @param from - The origin node and outcome.
 * @returns The node id, or undefined.
 * @example
 * ```ts
 * targetOfOutcome(graph, { node: "board/merge", outcome: "done" }); // "board/awaitIntent"
 * ```
 */
function targetOfOutcome(
  graph: GraphJson | undefined,
  from: { readonly node: string; readonly outcome?: string } | undefined
): string | undefined {
  if (graph === undefined || from?.outcome === undefined) return undefined;
  const flow = flowOf(from.node);
  const raw = graph.flows[flow]?.edges[from.node.slice(flow.length + 1)]?.[from.outcome];
  if (raw === undefined || raw.startsWith("exit:")) return undefined;
  return `${flow}/${raw.startsWith("map:") ? raw.slice("map:".length) : raw}`;
}

/**
 * Orders note paths newest first: a note's file name starts with its date, so a later name is
 * newer.
 *
 * @param a - A note path.
 * @param b - A note path.
 * @returns 1 when `a` sorts after `b`, else -1.
 * @example
 * ```ts
 * const paths = [".moku/notes/2026-09-01-a.md", ".moku/notes/2026-09-24-b.md"];
 * paths.toSorted(newestFirst)[0]; // ".moku/notes/2026-09-24-b.md"
 * ```
 */
function newestFirst(a: string, b: string): number {
  return baseName(a) < baseName(b) ? 1 : -1;
}

/**
 * True for a version-conflict rejection.
 *
 * @param error - A rejection.
 * @returns Whether the file changed meanwhile.
 * @example
 * ```ts
 * isConflict(wireError(-32_005, "version conflict")); // true
 * ```
 */
function isConflict(error: unknown): boolean {
  return isWireError(error) && error.code === errorCode.versionConflict;
}

/**
 * The codec input of a new note: only the keys that have a value.
 *
 * @param input - The create input.
 * @param to - The derived target.
 * @returns The NewNote.
 * @example
 * ```ts
 * newNoteOf({ title: "Idea" }, undefined); // { title: "Idea", created: "2026-09-24" }
 * ```
 */
function newNoteOf(input: NoteInput, to: string | undefined): NewNote {
  return {
    title: input.title,
    created: dateStamp(new Date()),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.from === undefined ? {} : { from: { ...input.from } }),
    ...(to === undefined ? {} : { to }),
    ...(input.captures === undefined ? {} : { captures: input.captures })
  };
}

/**
 * Creates the notes actions.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The notes actions.
 */
export function createNotesApi(ctx: FlowCtx, env: FlowEnvironment): NotesActions {
  const { notes } = ctx.state;
  const dir = ctx.config.notesDir;

  /**
   * Reads one note file; a front matter the codec cannot read is kept as `error`, never thrown.
   *
   * @param path - The note path.
   * @returns The note file.
   */
  async function readNote(path: string): Promise<NoteFile> {
    const file = await env.files().read(path);
    const parsed = parseNote(file.text);
    return isNoteParseError(parsed)
      ? { path, version: file.version, note: undefined, error: parsed }
      : { path, version: file.version, note: parsed, error: undefined };
  }

  /**
   * The note file names in notesDir; a missing folder is empty.
   *
   * @returns The names.
   */
  async function takenNames(): Promise<Set<string>> {
    try {
      const entries = await env.files().list(dir);
      return new Set(entries.map(entry => baseName(entry.path)));
    } catch {
      return new Set();
    }
  }

  /**
   * The note file paths in notesDir, newest name first, at most MAX_NOTES; a missing folder has
   * none.
   *
   * @returns The paths.
   */
  async function notePaths(): Promise<string[]> {
    try {
      const entries = await env.files().list(dir);
      return entries
        .filter(entry => entry.kind === "file" && entry.path.endsWith(".md"))
        .map(entry => entry.path)
        .toSorted(newestFirst)
        .slice(0, MAX_NOTES);
    } catch {
      return [];
    }
  }

  /**
   * Reads note files in parallel; a file that cannot be read is logged and left out.
   *
   * @param paths - The note paths.
   * @returns The note files, in the order of the paths.
   */
  async function readAll(paths: readonly string[]): Promise<NoteFile[]> {
    const read = await Promise.allSettled(paths.map(path => readNote(path)));
    return read.flatMap((outcome, index) => {
      if (outcome.status === "fulfilled") return [outcome.value];
      ctx.log.warn("flowView: a note could not be read", {
        path: paths[index],
        message: String(outcome.reason)
      });
      return [];
    });
  }

  const actions: NotesActions = {
    list: () => [...notes.files],

    edit: draft => {
      const base: NoteDraft = {
        title: "",
        body: "",
        from: undefined,
        captures: [],
        anchor: undefined
      };
      notes.editor = { ...base, ...draft };
      ctx.state.focus.menu = undefined;
      notify(ctx.state);
    },

    create: async input => {
      const name = noteFileName(new Date(), input.title, await takenNames());
      const path = `${dir}/${name}`;
      const note = newNote(
        newNoteOf(input, input.to ?? targetOfOutcome(ctx.state.data.graph, input.from))
      );
      const written = await env.files().write(path, formatNote(note));
      env.toast("✓ Note saved", path);
      await actions.load();
      return { path, version: written.version, note, error: undefined };
    },

    attach: async (path, captures) => {
      // Read, add the captures, write with the read version; a conflict reads again, bounded.
      for (let attempt = 0; ; attempt += 1) {
        const file = await readNote(path);
        if (file.note === undefined) {
          throw new Error(
            `[moku-editor] ${path} has a front matter flowView cannot read (line ${file.error?.line ?? 1}).\n  Fix it in Files; the note is not rewritten.`
          );
        }
        const next = addCaptures(file.note, captures);
        try {
          const written = await env.files().write(path, formatNote(next), file.version);
          env.toast(`✓ Attached to ${next.title}`);
          await actions.load();
          return { path, version: written.version, note: next, error: undefined };
        } catch (error) {
          const retry = attempt < ATTACH_RETRIES && isConflict(error);
          if (!retry) throw error;
        }
      }
    },

    load: async () => {
      notes.files = await readAll(await notePaths());
      notes.loaded = true;
      notify(ctx.state);
      env
        .actions()
        .layout.relayout()
        .catch(() => {});
    },

    anchors: () => {
      const anchors: NoteAnchor[] = [];
      for (const file of notes.files) {
        const note = file.note;
        if (note === undefined) continue;
        const from = note.from === undefined ? undefined : { ...note.from };
        const flow =
          from === undefined
            ? (ctx.state.layout.pins.notes[file.path]?.flow ?? "")
            : flowOf(from.node);
        anchors.push({ path: file.path, flow, from, title: note.title });
      }
      return anchors;
    },

    update: patch => {
      if (notes.editor === undefined) return;
      notes.editor = { ...notes.editor, ...patch };
      notify(ctx.state);
    },

    save: async () => {
      const draft = notes.editor;
      if (draft === undefined || draft.title.trim() === "") return;
      const file = await actions.create({
        title: draft.title.trim(),
        body: draft.body,
        captures: draft.captures,
        ...(draft.from === undefined ? {} : { from: draft.from })
      });
      notes.editor = undefined;
      if (draft.from === undefined && draft.anchor !== undefined) {
        env
          .actions()
          .layout.dropNote(file.path, env.actions().layout.root(), draft.anchor.x, draft.anchor.y);
      }
      notify(ctx.state);
      return file;
    },

    close: () => {
      if (notes.editor === undefined) return false;
      notes.editor = undefined;
      notify(ctx.state);
      return true;
    },

    draftPath: () => {
      const taken = new Set(notes.files.map(file => baseName(file.path)));
      return `${dir}/${noteFileName(new Date(), notes.editor?.title ?? "", taken)}`;
    }
  };
  return actions;
}
