/**
 * @file flowView inspector module — the Code tab (C3): file bar (path, Open in editor, Open in
 * Files, Edit here), the viewer (mono, gutter, shared highlighter tokens, the node's line
 * highlighted and scrolled into view), the placeholders, edit mode (Cancel, Save ⌘S, framed editor,
 * hint, "Discard changes?"), the result line and the conflict choices.
 */
import type { VNode } from "preact";
import { useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { langOf, renderTokens, tokenizeLines } from "../../panels/shared/highlight";
import type { FlowActions, FlowCtx, NodeId } from "../types";
import { useElement, useFlowStore } from "../useFlowStore";
import { MAX_LINES, TOO_LONG } from "./files";

/**
 * Props of `CodeTab`.
 */
export type CodeTabProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  readonly id: NodeId | undefined;
};

/**
 * The read-only viewer.
 *
 * @param props - Path, text and the node's line.
 * @param props.path - The file path.
 * @param props.text - The file text.
 * @param props.line - The highlighted line.
 * @returns The viewer.
 * @example
 * ```tsx
 * <Viewer path="nodes/merge.ts" text={text} line={3} />
 * ```
 */
function Viewer(props: {
  readonly path: string;
  readonly text: string;
  readonly line: number;
}): VNode {
  const { path, text, line } = props;
  const lines = useMemo(() => tokenizeLines(text, langOf(path)), [path, text]);
  const box = useElement<HTMLDivElement>();
  useLayoutEffect(() => {
    const target = box.current?.querySelector<HTMLElement>("[data-highlight]");
    if (target !== undefined && target !== null && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center" });
    }
  }, [box, line, text]);
  return (
    <div data-part="viewer" ref={box.ref}>
      {lines.map((tokens, index) => (
        <div
          key={`${index + 1}`}
          data-line={index + 1}
          data-highlight={index + 1 === line ? "" : undefined}
        >
          <span data-part="gutter">{index + 1}</span>
          <code data-part="code">{renderTokens(tokens)}</code>
        </div>
      ))}
    </div>
  );
}

/**
 * The Code tab.
 *
 * @param props - Context, actions and the shown node.
 * @returns The tab body.
 */
export function CodeTab(props: CodeTabProps): VNode {
  const { ctx, actions, id } = props;
  useFlowStore(ctx, state => state.view.revision);
  useEffect(() => {
    if (id !== undefined) actions.inspector.openCode(id).catch(() => {});
  }, [actions, id]);

  const { code, codeNote } = ctx.state.inspector;
  if (code === undefined) {
    return (
      <div data-flow="code-tab" data-part="body">
        <p data-part="placeholder">{codeNote ?? "Source loads from the dev server."}</p>
      </div>
    );
  }
  const editorUrl = actions.inspector.editorUrl(code.path, code.line);
  const tooLong = code.text.split("\n").length > MAX_LINES;
  const editing = code.draft !== undefined;
  const draft = code.draft ?? "";

  return (
    <div data-flow="code-tab" data-part="body" data-editing={editing ? "" : undefined}>
      <div data-part="file-bar">
        <code data-part="path">{code.path}</code>
        {editorUrl !== undefined && (
          <a data-action="open-editor" href={editorUrl}>
            Open in editor
          </a>
        )}
        <button
          type="button"
          data-action="open-files"
          onClick={() => actions.inspector.openInFiles(code.path, code.line)}
        >
          Open in Files
        </button>
        {!editing && !tooLong && (
          <button type="button" data-action="edit" onClick={() => actions.inspector.edit()}>
            Edit here
          </button>
        )}
      </div>
      {tooLong && <p data-part="placeholder">{TOO_LONG}</p>}
      {!tooLong && !editing && <Viewer path={code.path} text={code.text} line={code.line} />}
      {editing && (
        <div data-part="editor">
          <div data-part="buttons">
            <button
              type="button"
              data-action="cancel"
              onClick={() => actions.inspector.cancelEdit()}
            >
              Cancel
            </button>
            <button
              type="button"
              data-action="save"
              onClick={() => {
                actions.inspector.saveCode().catch(() => {});
              }}
            >
              Save ⌘S
            </button>
          </div>
          <textarea
            aria-label={`Edit ${code.path}`}
            spellcheck={false}
            value={draft}
            onInput={event => actions.inspector.setDraft(event.currentTarget.value)}
          />
          <p data-part="hint">⌘S saves · Esc cancels</p>
          {code.discard && (
            <p data-part="discard">
              Discard changes?
              <button type="button" onClick={() => actions.inspector.discard()}>
                Discard
              </button>
              <button type="button" onClick={() => actions.inspector.setDraft(draft)}>
                Keep editing
              </button>
            </p>
          )}
        </div>
      )}
      {code.result !== undefined && (
        <p data-part="result" data-ok={code.result.ok ? "" : undefined}>
          {code.result.text}
        </p>
      )}
      {code.conflict && (
        <p data-part="conflict">
          <button
            type="button"
            onClick={() => {
              actions.inspector.reloadCode().catch(() => {});
            }}
          >
            Reload file
          </button>
          <button
            type="button"
            onClick={() => {
              actions.inspector.saveCode(true).catch(() => {});
            }}
          >
            Save anyway
          </button>
        </p>
      )}
    </div>
  );
}
