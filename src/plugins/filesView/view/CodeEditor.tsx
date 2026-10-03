/**
 * @file filesView plugin — the in-place editor: a textarea stacked exactly over the highlighted
 * layer (transparent text, ink caret) in one scroll container, sized to its content so no scroll
 * sync is needed; input writes the buffer, colour follows 60 ms later; Tab inserts two spaces;
 * no colour above EDIT_COLOUR_LINES. The gutter stays visible.
 */
import type { ComponentChildren, VNode } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { langOf, renderTokens } from "../../panels/shared/highlight";
import type { FilesViewApi, OpenTab } from "../types";
import { EDIT_COLOUR_LINES } from "../types";
import { tokenLines } from "./CodeView";

/**
 * Delay between an edit and the new colours.
 */
const RETOKENIZE_MS = 60;

/**
 * What Tab inserts.
 */
const INDENT = "  ";

/**
 * Props of `CodeEditor`.
 *
 * @example
 * ```tsx
 * <CodeEditor api={api} tab={tab} />
 * ```
 */
export type CodeEditorProps = { readonly api: FilesViewApi; readonly tab: OpenTab };

/**
 * Inserts two spaces at the selection on Tab (no modifier); the buffer follows.
 *
 * @param event - The key event of the textarea.
 * @param write - Writes the new buffer.
 * @example
 * ```ts
 * onTab(event, text => api.setBuffer(path, text));
 * ```
 */
function onTab(event: KeyboardEvent, write: (text: string) => void): void {
  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const area = event.currentTarget;
  if (!(area instanceof HTMLTextAreaElement)) return;
  event.preventDefault();
  const { selectionStart, selectionEnd, value } = area;
  const next = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd);
  area.value = next;
  area.setSelectionRange(selectionStart + INDENT.length, selectionStart + INDENT.length);
  write(next);
}

/**
 * The editor of a tab in edit mode.
 *
 * @param props - The api and the tab.
 * @returns The editor.
 * @example
 * ```tsx
 * <CodeEditor api={api} tab={tab} />
 * ```
 */
export function CodeEditor(props: CodeEditorProps): VNode {
  const { api, tab } = props;
  const buffer = tab.buffer ?? "";
  const [shown, setShown] = useState(buffer);

  useEffect(() => {
    const timer = setTimeout(() => setShown(buffer), RETOKENIZE_MS);
    return () => clearTimeout(timer);
  }, [buffer]);

  const lines = buffer.split(/\r?\n/);
  const colour = lines.length <= EDIT_COLOUR_LINES;
  const layer = useMemo(
    () => tokenLines(shown, langOf(tab.path), colour),
    [shown, tab.path, colour]
  );
  let longest = 0;
  for (const line of lines) longest = Math.max(longest, line.length);
  const numbers: number[] = [];
  for (let number = 1; number <= lines.length; number += 1) numbers.push(number);
  const rendered: ComponentChildren[] = [];
  for (const [index, tokens] of layer.entries()) {
    if (index > 0) rendered.push("\n");
    rendered.push(renderTokens(tokens));
  }

  return (
    <div data-part="code-editor">
      {!colour && <p data-code-note>Colours off while editing large files</p>}
      <div data-editor-scroll>
        <div data-editor-gutter aria-hidden="true">
          {numbers.map(number => (
            <span key={number}>{number}</span>
          ))}
        </div>
        <div data-editor-stack>
          <pre data-editor-layer aria-hidden="true">
            {rendered}
          </pre>
          <textarea
            aria-label={`Edit ${tab.path}`}
            value={buffer}
            rows={lines.length}
            wrap="off"
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            style={{ width: `${longest + 2}ch` }}
            onInput={event => api.setBuffer(tab.path, event.currentTarget.value)}
            onKeyDown={event => onTab(event, text => api.setBuffer(tab.path, text))}
          />
        </div>
      </div>
      <p data-editor-hint>⌘S saves · Esc stops editing · Esc, then Tab leaves the editor</p>
    </div>
  );
}
