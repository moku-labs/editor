/**
 * @file gameView plugin — notes for the note select (D6) and "Attach to note": the capture path
 * goes into the note's front matter `captures[]` through the shared codec (panels/shared/notes,
 * R4), written with the read version; one re-read on a conflict. "New note…" is flowView's job:
 * gameView emits `workspace:new-note`.
 */
import { linkPlugin } from "../../link";
import { addCaptures, formatNote, isNoteParseError, parseNote } from "../../panels/shared/notes";
import type { FileEntry, FileText } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { isConflict, reportFailure } from "../report";
import type { GameViewCtx } from "../types";

/**
 * Toast of a note whose front matter the codec cannot read.
 */
const UNREADABLE_TEXT = "Front matter not readable · Open in Files";

/**
 * The file name of a path without its extension.
 *
 * @param path - A path.
 * @returns The bare name.
 * @example
 * ```ts
 * bareName(".moku/notes/2026-09-22-broken.md"); // "2026-09-22-broken"
 * ```
 */
function bareName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The title of one note; its file name when it cannot be read.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The note path.
 * @returns The title.
 */
async function noteTitle(ctx: GameViewCtx, path: string): Promise<string> {
  try {
    const file = await ctx.require(linkPlugin).files.read(path);
    const note = parseNote(file.text);
    return isNoteParseError(note) ? bareName(path) : note.title;
  } catch {
    return bareName(path);
  }
}

/**
 * The notes under `notesDir`, newest first by file name, with their titles.
 *
 * @param ctx - Domain context of gameView.
 * @returns Path and title of every `.md` note; empty without the folder.
 */
export async function listNotes(
  ctx: GameViewCtx
): Promise<readonly { path: string; title: string }[]> {
  let entries: readonly FileEntry[];
  try {
    entries = await ctx.require(linkPlugin).files.list(ctx.config.notesDir);
  } catch {
    return [];
  }
  const notes = entries
    .filter(entry => entry.kind === "file" && entry.path.endsWith(".md"))
    .map(entry => entry.path)
    .toSorted((a, b) => b.localeCompare(a));
  return Promise.all(notes.map(async path => ({ path, title: await noteTitle(ctx, path) })));
}

/**
 * Reads a note; a failure is toasted and gives undefined.
 *
 * @param ctx - Domain context of gameView.
 * @param notePath - The note.
 * @returns The text and version, or undefined.
 */
async function readNote(ctx: GameViewCtx, notePath: string): Promise<FileText | undefined> {
  try {
    return await ctx.require(linkPlugin).files.read(notePath);
  } catch (error) {
    reportFailure(ctx, "Attach failed", "gameView: attach failed", error);
    return undefined;
  }
}

/**
 * One read-edit-write round; "retry" when the write met a version conflict.
 *
 * @param ctx - Domain context of gameView.
 * @param capture - The capture path.
 * @param notePath - The note.
 * @param last - True on the second round (a conflict is then reported).
 * @returns "done" or "retry".
 */
async function attachOnce(
  ctx: GameViewCtx,
  capture: string,
  notePath: string,
  last: boolean
): Promise<"done" | "retry"> {
  const workspace = ctx.require(workspacePlugin);
  const file = await readNote(ctx, notePath);
  if (file === undefined) return "done";

  const note = parseNote(file.text);
  if (isNoteParseError(note)) {
    workspace.toast(UNREADABLE_TEXT, notePath);
    return "done";
  }
  const next = addCaptures(note, [capture]);
  try {
    if (next.captures.length !== note.captures.length) {
      await ctx.require(linkPlugin).files.write(notePath, formatNote(next), file.version);
    }
  } catch (error) {
    if (!last && isConflict(error)) return "retry";
    reportFailure(ctx, "Attach failed", "gameView: attach failed", error);
    return "done";
  }
  workspace.toast(`✓ Attached to ${note.title}`, notePath);
  return "done";
}

/**
 * Adds a capture to a note's `captures[]` (once), written with the version; one retry after a
 * conflict. A note whose front matter is not readable is never rewritten.
 *
 * @param ctx - Domain context of gameView.
 * @param capture - The PNG or series index.json path.
 * @param notePath - The note path.
 * @returns Resolves when written or the reason was toasted.
 */
export async function attachCapture(
  ctx: GameViewCtx,
  capture: string,
  notePath: string
): Promise<void> {
  if ((await attachOnce(ctx, capture, notePath, false)) === "retry") {
    await attachOnce(ctx, capture, notePath, true);
  }
}

/**
 * "New note…": asks flowView for its note editor with the capture (and the node, when known).
 *
 * @param ctx - Domain context of gameView.
 * @param capture - The capture path.
 * @param node - "<flow>/<node>" of the watched game.position, undefined without one.
 */
export function requestNewNote(ctx: GameViewCtx, capture: string, node: string | undefined): void {
  ctx.emit(
    "workspace:new-note",
    node === undefined ? { captures: [capture] } : { captures: [capture], from: { node } }
  );
}
