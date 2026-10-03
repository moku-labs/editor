/**
 * @file flowView render module — a note on the canvas: title, up to 3 body lines, the capture
 * count and the file; `data-status`; draggable like a card, pinned mark when moved (F9).
 */
import type { VNode } from "preact";
import type { Item } from "../types";
import type { NoteView } from "./types";

/**
 * Props of `NoteNode`.
 */
export type NoteNodeProps = {
  readonly item: Item;
  readonly view: NoteView;
  readonly selected?: boolean;
};

/**
 * One note node.
 *
 * @param props - The note item and its view.
 * @returns The note.
 * @example
 * ```tsx
 * <NoteNode item={note} view={world.notes.get(note.key)} />
 * ```
 */
export function NoteNode(props: NoteNodeProps): VNode {
  const { item, view } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card holds its own buttons; a <button> cannot nest them
    <div
      data-flow="note-node"
      data-hit="note"
      data-key={item.key}
      data-status={view.status}
      data-pinned={item.pinned ? "" : undefined}
      data-selected={props.selected === true ? "" : undefined}
      role="button"
      tabIndex={0}
      aria-label={view.title}
      style={{
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.w}px`,
        minHeight: `${item.h}px`
      }}
    >
      <strong data-part="title">{view.title}</strong>
      {view.lines.map(line => (
        <span key={line} data-part="line">
          {line}
        </span>
      ))}
      {view.captures > 0 && (
        <span data-part="captures">{`${view.captures} ${view.captures === 1 ? "capture" : "captures"}`}</span>
      )}
      <code data-part="file">{item.id.slice(item.id.lastIndexOf("/") + 1)}</code>
      {item.pinned && <span data-part="pin" role="img" aria-label="Pinned" />}
    </div>
  );
}
