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
 * @example
 * ```ts
 * await createNotesApi(ctx, env).create({ title: "First wood 4" });
 * ```
 */
export function createNotesApi(ctx: FlowCtx, env: FlowEnvironment): NotesActions {
  const { notes } = ctx.state;
  const dir = ctx.config.notesDir;

  /**
   * Reads one note file.
   *
   * @param path - The note path.
   * @returns The note file.
   * @example
   * ```ts
   * await readNote(".moku/notes/a.md");
   * ```
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
   * @example
   * ```ts
   * await takenNames(); // Set { "2026-09-24-first-top-item.md" }
   * ```
   */
  async function takenNames(): Promise<Set<string>> {
    try {
      const entries = await env.files().list(dir);
      return new Set(entries.map(entry => baseName(entry.path)));
    } catch {
      return new Set();
    }
  }

  const actions: NotesActions = {
    /**
     * The note files, newest first.
     *
     * @returns A copy.
     * @example
     * ```ts
     * actions.notes.list();
     * ```
     */
    list() {
      return [...notes.files];
    },

    /**
     * Opens the note editor.
     *
     * @param draft - Prefilled fields.
     * @example
     * ```ts
     * actions.notes.edit({ captures: [".moku/captures/a.png"] });
     * ```
     */
    edit(draft) {
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

    /**
     * Writes a new note file.
     *
     * @param input - The note.
     * @returns The note file.
     * @example
     * ```ts
     * await actions.notes.create({ title: "First wood 4" });
     * ```
     */
    async create(input) {
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

    /**
     * Appends captures to a note.
     *
     * @param path - The note path.
     * @param captures - Capture paths.
     * @returns The rewritten note file.
     * @throws {Error} When the front matter is not readable.
     * @example
     * ```ts
     * await actions.notes.attach(".moku/notes/a.md", ["a.png"]);
     * ```
     */
    async attach(path, captures) {
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
          if (attempt > 0 || !isConflict(error)) throw error;
        }
      }
    },

    /**
     * Lists and reads the note files.
     *
     * @returns Resolves when loaded.
     * @example
     * ```ts
     * await actions.notes.load();
     * ```
     */
    async load() {
      let paths: string[] = [];
      try {
        const entries = await env.files().list(dir);
        paths = entries
          .filter(entry => entry.kind === "file" && entry.path.endsWith(".md"))
          .map(entry => entry.path)
          .toSorted((a, b) => (baseName(a) < baseName(b) ? 1 : -1))
          .slice(0, MAX_NOTES);
      } catch {
        paths = [];
      }
      const read = await Promise.allSettled(paths.map(path => readNote(path)));
      notes.files = read.flatMap((outcome, index) => {
        if (outcome.status === "fulfilled") return [outcome.value];
        ctx.log.warn("flowView: a note could not be read", {
          path: paths[index],
          message: String(outcome.reason)
        });
        return [];
      });
      notes.loaded = true;
      notify(ctx.state);
      env
        .actions()
        .layout.relayout()
        .catch(() => {});
    },

    /**
     * Where each readable note sits.
     *
     * @returns The anchors.
     * @example
     * ```ts
     * actions.notes.anchors();
     * ```
     */
    anchors() {
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

    /**
     * Patches the draft.
     *
     * @param patch - Fields to change.
     * @example
     * ```ts
     * actions.notes.update({ title: "First wood 4" });
     * ```
     */
    update(patch) {
      if (notes.editor === undefined) return;
      notes.editor = { ...notes.editor, ...patch };
      notify(ctx.state);
    },

    /**
     * Saves the draft.
     *
     * @returns The note file, or undefined without a draft or a title.
     * @example
     * ```ts
     * await actions.notes.save();
     * ```
     */
    async save() {
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

    /**
     * Closes the editor.
     *
     * @returns False when it was not open.
     * @example
     * ```ts
     * actions.notes.close();
     * ```
     */
    close() {
      if (notes.editor === undefined) return false;
      notes.editor = undefined;
      notify(ctx.state);
      return true;
    },

    /**
     * The path the draft will get.
     *
     * @returns The path.
     * @example
     * ```ts
     * actions.notes.draftPath(); // ".moku/notes/2026-09-24-first-wood-4.md"
     * ```
     */
    draftPath() {
      const taken = new Set(notes.files.map(file => baseName(file.path)));
      return `${dir}/${noteFileName(new Date(), notes.editor?.title ?? "", taken)}`;
    }
  };
  return actions;
}
