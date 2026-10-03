/**
 * @file gameView plugin — the note select (D6) of the capture card and the contact sheet: every
 * note (newest first, the default) and "New note…"; the button attaches the capture, or asks
 * flowView for its note editor (`workspace:new-note`, R4).
 */
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { attachCapture, listNotes, requestNewNote } from "../notes/attach";
import type { GameViewCtx } from "../types";

/**
 * Props of `NoteSelect`.
 */
export type NoteSelectProps = {
  readonly ctx: GameViewCtx;
  /** The PNG or series index.json to attach. */
  readonly capture: string;
  /** "<flow>/<node>" of the watched game.position, undefined without one. */
  readonly node: string | undefined;
};

/**
 * The value of the "New note…" option.
 */
const NEW_NOTE = "new";

/**
 * The note select with its button.
 *
 * @param props - The context, the capture path and the node.
 * @returns The select row.
 * @example
 * ```tsx
 * <NoteSelect ctx={ctx} capture={card.path} node="board/awaitIntent" />
 * ```
 */
export function NoteSelect(props: NoteSelectProps): VNode {
  const { ctx, capture, node } = props;
  const [notes, setNotes] = useState<readonly { path: string; title: string }[]>([]);
  const [choice, setChoice] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    listNotes(ctx).then(list => {
      if (alive) setNotes(list);
    });
    return () => {
      alive = false;
    };
  }, [ctx, capture]);
  const value = choice ?? notes[0]?.path ?? NEW_NOTE;
  const fresh = value === NEW_NOTE;

  return (
    <div data-part="attach">
      <select
        aria-label="Note"
        value={value}
        onChange={event => setChoice(event.currentTarget.value)}
      >
        {notes.map(note => (
          <option key={note.path} value={note.path}>
            {note.title}
          </option>
        ))}
        <option value={NEW_NOTE}>New note…</option>
      </select>
      <button
        type="button"
        onClick={() =>
          fresh ? requestNewNote(ctx, capture, node) : attachCapture(ctx, capture, value)
        }
      >
        {fresh ? "New note…" : "Attach to note"}
      </button>
    </div>
  );
}
