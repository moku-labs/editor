/**
 * @file flowView notes module — the note editor (D5): a modal `<dialog>` in the browser top layer
 * (M7, above the game frame): "New note", the context "On board/merge · done" or "Free note on the
 * canvas", the capture row, title, body, the live file path, Cancel / Save note (⌘S or ⌘↵). Esc
 * closes; focus returns to the opener.
 */
import type { VNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { FlowActions, FlowCtx } from "../types";
import { useElement, useFlowStore } from "../useFlowStore";

/**
 * Props of `NoteEditor`.
 */
export type NoteEditorProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The thumbnails of the captures (data URLs read through link.files.readBinary).
 *
 * @param props - Context and capture paths.
 * @param props.ctx - Domain context of flowView.
 * @param props.captures - Capture paths.
 * @returns The thumbnail row.
 */
function Thumbnails(props: { readonly ctx: FlowCtx; readonly captures: readonly string[] }): VNode {
  const { ctx, captures } = props;
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const files = ctx.state.view.files;
    for (const path of captures.filter(capture => capture.endsWith(".png"))) {
      files
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
  const text =
    captures.length === 1
      ? "The screenshot attaches to this note"
      : `${captures.length} shots attach to this note`;
  return (
    <div data-part="captures">
      <span>{text}</span>
      {captures.map(path => (
        <img key={path} data-part="thumbnail" alt={path} src={urls[path]} />
      ))}
    </div>
  );
}

/**
 * The context line of the editor: "On board/merge · done" or "Free note on the canvas".
 *
 * @param from - The origin node and outcome.
 * @returns The line.
 * @example
 * ```ts
 * contextText({ node: "board/merge", outcome: "done" }); // "On board/merge · done"
 * ```
 */
function contextText(
  from: { readonly node: string; readonly outcome?: string } | undefined
): string {
  if (from === undefined) return "Free note on the canvas";
  return from.outcome === undefined ? `On ${from.node}` : `On ${from.node} · ${from.outcome}`;
}

/**
 * The note editor.
 *
 * @param props - Context and actions.
 * @returns The dialog, or an empty fragment while closed.
 */
export function NoteEditor(props: NoteEditorProps): VNode {
  const { ctx, actions } = props;
  const draft = useFlowStore(ctx, state => state.notes.editor);
  const dialog = useElement<HTMLDialogElement>();
  const opener = useRef<HTMLElement | undefined>(undefined);
  const open = draft !== undefined;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || element === undefined) return;
    const active = element.ownerDocument.activeElement;
    opener.current = active instanceof HTMLElement ? active : undefined;
    if (typeof element.showModal === "function" && !element.hasAttribute("open"))
      element.showModal();
    element.querySelector<HTMLInputElement>('[data-field="title"]')?.focus();
    return () => {
      const back = opener.current;
      opener.current = undefined;
      back?.focus();
    };
  }, [open, dialog]);

  if (draft === undefined) return <span data-closed="note-editor" hidden />;
  /**
   * Saves the draft (a failure is logged).
   */
  const save = (): void => {
    actions.notes.save().catch((error: unknown) => {
      ctx.log.warn("flowView: note not saved", { message: String(error) });
    });
  };
  const context = contextText(draft.from);

  return (
    <dialog
      data-flow="note-editor"
      data-chrome=""
      aria-modal="true"
      aria-label="New note"
      ref={dialog.ref}
      onCancel={event => {
        event.preventDefault();
        actions.notes.close();
      }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "Enter")) {
          event.preventDefault();
          save();
        }
      }}
    >
      <h2 data-part="title">New note</h2>
      <p data-part="context">{context}</p>
      {draft.captures.length > 0 && <Thumbnails ctx={ctx} captures={draft.captures} />}
      <input
        data-field="title"
        type="text"
        aria-label="Title"
        placeholder="Title"
        value={draft.title}
        onInput={event => actions.notes.update({ title: event.currentTarget.value })}
      />
      <textarea
        data-field="body"
        aria-label="What should the agent build?"
        placeholder="What should the agent build?"
        value={draft.body}
        onInput={event => actions.notes.update({ body: event.currentTarget.value })}
      />
      <code data-part="path">{actions.notes.draftPath()}</code>
      <div data-part="buttons">
        <button type="button" data-action="cancel" onClick={() => actions.notes.close()}>
          Cancel
        </button>
        <button
          type="button"
          data-action="save"
          disabled={draft.title.trim() === ""}
          onClick={save}
        >
          Save note
        </button>
      </div>
    </dialog>
  );
}
