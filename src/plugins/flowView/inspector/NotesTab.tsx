/**
 * @file flowView inspector module — the Notes tab (C5): "Notes are files an agent can find and
 * build.", New note (D5 for the shown node), the note cards (title, text, capture thumbnails, file,
 * `from · outcome → to · status · date`) and the unreadable notes ("Front matter not readable ·
 * Open in Files").
 */
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Note } from "../../panels/shared/notes";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Props of `NotesTab`.
 */
export type NotesTabProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly id: NodeId | undefined;
};

/**
 * The thumbnails of a note's PNG captures.
 *
 * @param props - Context and capture paths.
 * @param props.ctx - Domain context of flowView.
 * @param props.captures - Capture paths.
 * @returns The images.
 */
function Captures(props: { readonly ctx: FlowCtx; readonly captures: readonly string[] }): VNode {
  const { ctx, captures } = props;
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const path of captures.filter(capture => capture.endsWith(".png"))) {
      ctx.state.view.files
        ?.readBinary(path)
        .then(binary => {
          if (live) setUrls(previous => ({ ...previous, [path]: binary.dataUrl }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [ctx, captures]);
  return (
    <div data-part="captures">
      {captures.map(path => (
        <img key={path} data-part="thumbnail" alt={path} src={urls[path]} />
      ))}
    </div>
  );
}

/**
 * The meta line of a note: `from · outcome → to · status · date`.
 *
 * @param note - The note.
 * @returns The line.
 */
export function noteMeta(note: Note): string {
  const from = note.from;
  let origin = "free";
  if (from !== undefined)
    origin = from.outcome === undefined ? from.node : `${from.node} · ${from.outcome}`;
  const target = note.to === undefined ? origin : `${origin} → ${note.to}`;
  return [target, note.status, note.created ?? ""].filter(part => part !== "").join(" · ");
}

/**
 * The Notes tab.
 *
 * @param props - Context, actions and the shown node.
 * @returns The tab body.
 */
export function NotesTab(props: NotesTabProps): VNode {
  const { ctx, actions, id } = props;
  useFlowStore(ctx, state => state.view.revision);
  const files = ctx.state.notes.files;
  const mine = files.filter(file => file.note !== undefined && file.note.from?.node === id);
  const unreadable = files.filter(file => file.note === undefined);
  return (
    <div data-flow="notes-tab" data-part="body">
      <p data-part="intro">Notes are files an agent can find and build.</p>
      <button
        type="button"
        data-action="new-note"
        onClick={() => actions.notes.edit(id === undefined ? {} : { from: { node: id } })}
      >
        New note
      </button>
      {mine.map(file => {
        const note = file.note;
        if (note === undefined) return false;
        return (
          <article key={file.path} data-part="note" data-status={note.status}>
            <strong>{note.title}</strong>
            <p data-part="text">{note.body.trim().split("\n").slice(0, 3).join(" ")}</p>
            {note.captures.length > 0 && <Captures ctx={ctx} captures={note.captures} />}
            <code data-part="file">{file.path}</code>
            <span data-part="meta">{noteMeta(note)}</span>
          </article>
        );
      })}
      {unreadable.map(file => (
        <p key={file.path} data-part="unreadable">
          <code>{file.path}</code>
          {" Front matter not readable · "}
          <button
            type="button"
            onClick={() => actions.inspector.openInFiles(file.path, file.error?.line)}
          >
            Open in Files
          </button>
        </p>
      ))}
    </div>
  );
}
