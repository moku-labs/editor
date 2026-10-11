/**
 * @file gameView plugin — the Text style section of the Element tab (D-73): a text node with a
 * text style key (`SceneNode.textStyle`, the key the engine sends) shows the block of that key in
 * the text styles file, titled "Text style · <key>", with `file:line` and "Open in Files". Every
 * field of the block is a row: a number and a quoted string are fields like the Styles rows (the
 * same component), anything else is read-only text. An edit is a pending edit of the style key,
 * not of the node: every text node with the key shows it. A key the project index does not know
 * shows the shared not-found line and no fields.
 */
import type { VNode } from "preact";
import { linkPlugin } from "../../link";
import { notFoundText } from "../../panels/shared/project";
import { type EditField, type EditOwner, editsOf, textStyleEditKey } from "../element/edits";
import { openInFiles } from "../element/select";
import type { GameViewCtx, TextStyleCard, TextStyleRow } from "../types";
import { StyleRow } from "./StyleFields";

/**
 * Props of `TextStyleSection`: the context and the text style key of the selected node.
 *
 * @example
 * ```tsx
 * <TextStyleSection ctx={ctx} textStyle="ui.button" />
 * ```
 */
export type TextStyleSectionProps = {
  readonly ctx: GameViewCtx;
  /** The text style key the engine sent for the node: "ui.button". */
  readonly textStyle: string;
};

/**
 * The fields of a row: one for a value a field edits, none for a read-only row.
 *
 * @param row - A row of the text style block.
 * @returns The fields, undefined for a read-only row.
 * @example
 * ```ts
 * fieldsOf({ path: "size", raw: "105", value: 105 }); // [{ path: "size", label: undefined, value: 105 }]
 * fieldsOf({ path: "fill", raw: "colors.cream", value: undefined }); // undefined
 * ```
 */
function fieldsOf(row: TextStyleRow): readonly EditField[] | undefined {
  if (row.value === undefined) return undefined;
  return [{ path: row.path, label: undefined, value: row.value }];
}

/**
 * The block that was read: where it is, Open in Files and one row per field.
 *
 * @param props - The context and the block.
 * @param props.ctx - Domain context of gameView.
 * @param props.card - The block of the key as read.
 * @returns The head and the rows.
 */
function TextStyleRows(props: {
  readonly ctx: GameViewCtx;
  readonly card: Extract<TextStyleCard, { readonly status: "found" }>;
}): VNode {
  const { ctx, card } = props;
  const owner: EditOwner = { kind: "textStyle", key: card.key };
  const edits = editsOf(ctx.state.edits, textStyleEditKey(card.key));
  return (
    <>
      <header>
        <code data-part="where">
          {card.path}:{card.line}
        </code>
        <button type="button" onClick={() => openInFiles(ctx, card.path, card.line)}>
          Open in Files
        </button>
      </header>
      {card.rows.length > 0 && (
        <dl data-props="">
          {card.rows.map(row => (
            <StyleRow
              key={row.path}
              ctx={ctx}
              owner={owner}
              name={row.path}
              fields={fieldsOf(row)}
              text={row.raw}
              edits={edits}
            />
          ))}
        </dl>
      )}
    </>
  );
}

/**
 * The Text style section of a text node: its title, then the block of its key, that the project
 * index does not know the key (or why the index is off), or that the index is asked.
 *
 * @param props - The context and the text style key.
 * @returns The section.
 * @example
 * ```tsx
 * // homePlayLabel is `<text key="homePlayLabel" style="ui.button" content="Play" />`.
 * {node.textStyle !== undefined && <TextStyleSection ctx={ctx} textStyle={node.textStyle} />}
 * ```
 */
export function TextStyleSection(props: TextStyleSectionProps): VNode {
  const { ctx, textStyle } = props;
  // The block of another key is still shown for a moment after the selection changed.
  const shown = ctx.state.textStyle;
  const card = shown?.key === textStyle ? shown : undefined;
  return (
    <section data-part="text-style" aria-label={`Text style ${textStyle}`}>
      <h4>
        Text style · <span data-part="key">{textStyle}</span>
      </h4>
      {card?.status === "found" && <TextStyleRows ctx={ctx} card={card} />}
      {card?.status === "missing" && (
        <p data-part="not-found">
          {notFoundText(ctx.require(linkPlugin).project(), `textStyle:${textStyle}`)}
        </p>
      )}
      {(card === undefined || card.status === "searching") && (
        <p>Finding textStyle:{textStyle} in the project index…</p>
      )}
    </section>
  );
}
