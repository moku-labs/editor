/**
 * @file gameView plugin — the fields of the Element tab's Styles section and its edits bar (U8,
 * D-67). Every entry of the element's scene style is a row: a number is a number field, a string
 * a text field, a string of an enum property (justify, align, direction …) a select with the
 * engine's values, a boolean a checkbox, a record of those (padding) one field per leaf; anything
 * else stays read-only text. A number or text field commits on Enter or on blur, a select and a
 * checkbox on `change`, as a pending edit (`editStyle`); Esc restores what the field showed and
 * commits nothing; what is being typed survives a re-render of the tab. A row with an edit shows
 * the scene value struck and a reset. Under the rows the bar counts the pending edits of every
 * element, copies them for the agent and clears them. The game does not change: nothing is
 * written and no command runs.
 *
 * The same fields edit the block of a text style key (D-73, `TextStyleSection`): every field
 * knows what its edit belongs to (`EditOwner`) and commits through `editValue`.
 */
import type { VNode } from "preact";
import { useRef } from "preact/hooks";
import type { SceneNode } from "../../panels/shared/scene";
import type { Json, StyleEdit, StyleValue } from "../../registry/protocol";
import { clearEdits, copyEdits, editValue, listEdits } from "../element/edit-style";
import {
  countText,
  type EditField,
  type EditOwner,
  editFields,
  editKey,
  editsOf,
  fieldKind,
  selectOptions
} from "../element/edits";
import type { GameViewCtx } from "../types";
import { styleValue } from "./text";

/**
 * The owner of the Styles rows: the selected element.
 */
const NODE: EditOwner = { kind: "node" };

/**
 * Props of one field: the context, what its edit belongs to, the field and its pending edit, if
 * any.
 */
type FieldProps = {
  readonly ctx: GameViewCtx;
  readonly owner: EditOwner;
  readonly field: EditField;
  readonly edit: StyleEdit | undefined;
};

/**
 * The value a typed text commits for a field: the text itself for a text field; the number for a
 * number field, undefined when the text is empty or no number.
 *
 * @param typed - The text of the field.
 * @param shown - The value the field showed, whose kind the field has.
 * @returns The value to commit, undefined to commit nothing.
 * @example
 * ```ts
 * typedValue("600", 556); // 600
 * typedValue("wide", 556); // undefined
 * typedValue("start", "center"); // "start"
 * ```
 */
function typedValue(typed: string, shown: number | string): StyleValue | undefined {
  if (typeof shown === "string") return typed;
  const next = typed.trim() === "" ? Number.NaN : Number(typed);
  return Number.isFinite(next) ? next : undefined;
}

/**
 * A number field (step 1) or a text field. What is being typed is kept in the field's own draft
 * until it is committed or dropped, so a re-render of the tab (a live game sends a new scene on
 * every heartbeat) does not reset it. Enter or a blur commits the draft, once; a text that is no
 * value commits nothing and the field shows its value again; Esc drops what was typed.
 *
 * There is no `onChange` here: with `preact/compat` loaded (the editor's page) it fires on every
 * keystroke. The draft is a ref, not state: a blur right after Enter or Esc, before the next
 * render, has to find it gone.
 *
 * @param props - The context, the owner, the path and the value the field shows.
 * @param props.ctx - Domain context of gameView.
 * @param props.owner - What the edit belongs to.
 * @param props.path - The style path, also the control's accessible name.
 * @param props.shown - The pending value, else the scene value.
 * @returns The input.
 */
function TypedInput(props: {
  readonly ctx: GameViewCtx;
  readonly owner: EditOwner;
  readonly path: string;
  readonly shown: number | string;
}): VNode {
  const { ctx, owner, path, shown } = props;
  const draft = useRef<string>();
  const isNumber = typeof shown === "number";

  /**
   * Ends the typing: the draft goes and the field shows its value again.
   *
   * @param input - The field.
   */
  const settle = (input: HTMLInputElement): void => {
    draft.current = undefined;
    input.value = String(shown);
  };

  /**
   * Commits the draft as an edit. Without a draft (nothing typed since the last commit or Esc)
   * it does nothing, so Enter and the blur after it commit once.
   *
   * @param input - The field.
   */
  const commit = (input: HTMLInputElement): void => {
    const typed = draft.current;
    if (typed === undefined) return;
    settle(input);
    const next = typedValue(typed, shown);
    if (next !== undefined) editValue(ctx, owner, path, next);
  };

  return (
    <input
      type={isNumber ? "number" : "text"}
      step={isNumber ? "1" : undefined}
      aria-label={path}
      value={draft.current ?? String(shown)}
      onInput={event => {
        draft.current = event.currentTarget.value;
      }}
      onBlur={event => commit(event.currentTarget)}
      onKeyDown={event => {
        if (event.key === "Enter") commit(event.currentTarget);
        else if (event.key === "Escape") settle(event.currentTarget);
      }}
    />
  );
}

/**
 * The select of an enum style property: one option per value. A choice (`change`) commits the
 * edit at once.
 *
 * @param props - The context, the owner, the path, the value the select shows and its options.
 * @param props.ctx - Domain context of gameView.
 * @param props.owner - What the edit belongs to.
 * @param props.path - The style path, also the control's accessible name.
 * @param props.shown - The pending value, else the scene value.
 * @param props.options - The engine's values, with the scene value when it is none of them.
 * @returns The select.
 */
function EnumSelect(props: {
  readonly ctx: GameViewCtx;
  readonly owner: EditOwner;
  readonly path: string;
  readonly shown: string;
  readonly options: readonly string[];
}): VNode {
  const { ctx, owner, path, shown, options } = props;
  return (
    <select
      aria-label={path}
      value={shown}
      onChange={event => editValue(ctx, owner, path, event.currentTarget.value)}
    >
      {options.map(option => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/**
 * The control of one field, by its kind (`fieldKind`): a checkbox, a select for an enum
 * property, a number field or a text field. The enums are the ones of an element's style: a
 * string of a text style key is always a text field.
 *
 * @param props - The context, the owner, the field and the value it shows.
 * @param props.ctx - Domain context of gameView.
 * @param props.owner - What the edit belongs to.
 * @param props.field - The field: its path is also the control's accessible name.
 * @param props.shown - The pending value, else the scene value.
 * @returns The control.
 */
function FieldInput(props: {
  readonly ctx: GameViewCtx;
  readonly owner: EditOwner;
  readonly field: EditField;
  readonly shown: StyleValue;
}): VNode {
  const { ctx, owner, field, shown } = props;
  const { path } = field;
  const isEnum = owner.kind === "node" && fieldKind(field, shown) === "select";
  if (typeof shown === "string" && isEnum) {
    const options = selectOptions(field, shown);
    return <EnumSelect ctx={ctx} owner={owner} path={path} shown={shown} options={options} />;
  }
  if (typeof shown !== "boolean") {
    return <TypedInput ctx={ctx} owner={owner} path={path} shown={shown} />;
  }
  return (
    <input
      type="checkbox"
      aria-label={path}
      checked={shown}
      onChange={event => editValue(ctx, owner, path, event.currentTarget.checked)}
    />
  );
}

/**
 * One field: the leaf name of a nested value, the control and, with a pending edit, the scene
 * value struck before it and the reset that removes the edit.
 *
 * @param props - The context, the owner, the field and its pending edit.
 * @returns The field.
 */
function StyleFieldView(props: FieldProps): VNode {
  const { ctx, owner, field, edit } = props;
  const { path, label, value } = field;
  return (
    <span data-part="field" data-path={path} data-edited={edit === undefined ? undefined : ""}>
      {label !== undefined && <span data-part="leaf">{label}</span>}
      {edit !== undefined && <s>{String(value)}</s>}
      <FieldInput ctx={ctx} owner={owner} field={field} shown={edit?.to ?? value} />
      {edit !== undefined && (
        <button
          type="button"
          data-action="reset-edit"
          title={`Reset to ${value}`}
          aria-label={`Reset ${path} to ${value}`}
          onClick={() => editValue(ctx, owner, path, value)}
        >
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Props of one row: the context, what its edits belong to, its name, its fields (undefined for a
 * read-only row, which shows `text`) and the pending edits of the owner.
 *
 * @example
 * ```tsx
 * <StyleRow ctx={ctx} owner={{ kind: "textStyle", key: "ui.button" }} name="size" fields={[{ path: "size", label: undefined, value: 105 }]} text="105" edits={edits} />
 * ```
 */
export type StyleRowProps = {
  readonly ctx: GameViewCtx;
  readonly owner: EditOwner;
  /** The style key, or the field of a text style block. */
  readonly name: string;
  /** The fields of the row; undefined for a value no field edits. */
  readonly fields: readonly EditField[] | undefined;
  /** What a read-only row shows. */
  readonly text: string;
  /** The pending edits of the owner. */
  readonly edits: readonly StyleEdit[];
};

/**
 * One row of a styles list: its name and its fields, or its read-only text. The Styles rows of
 * an element and the rows of a text style block (D-73) are both made of it.
 *
 * @param props - The context, the owner, the name, the fields or the text, and the edits.
 * @returns The row.
 * @example
 * ```tsx
 * // The `size` of the text style key ui.button, 105 in the file.
 * <StyleRow ctx={ctx} owner={{ kind: "textStyle", key: "ui.button" }} name="size" fields={[{ path: "size", label: undefined, value: 105 }]} text="105" edits={[]} />
 * ```
 */
export function StyleRow(props: StyleRowProps): VNode {
  const { ctx, owner, name, text, edits } = props;
  const fields = props.fields?.map(field => ({
    field,
    edit: edits.find(edit => edit.path === field.path)
  }));
  const isEdited = fields?.some(entry => entry.edit !== undefined) === true;
  return (
    <div data-row={name} data-edited={isEdited ? "" : undefined}>
      <dt>{name}</dt>
      <dd>
        {fields === undefined
          ? text
          : fields.map(entry => (
              <StyleFieldView
                key={entry.field.path}
                ctx={ctx}
                owner={owner}
                field={entry.field}
                edit={entry.edit}
              />
            ))}
      </dd>
    </div>
  );
}

/**
 * The fields and the read-only text of one entry of an element's scene style.
 *
 * @param name - The style key.
 * @param value - Its value in the scene.
 * @returns What its row shows.
 * @example
 * ```ts
 * entryRow("minWidth", 556); // { fields: [{ path: "minWidth", label: undefined, value: 556 }], text: "556" }
 * ```
 */
function entryRow(name: string, value: Json): Pick<StyleRowProps, "fields" | "text"> {
  return { fields: editFields(name, value), text: styleValue(value) };
}

/**
 * The rows of the Styles section: one per entry of the node's scene style, as fields.
 *
 * @param props - The context and the selected node.
 * @param props.ctx - Domain context of gameView.
 * @param props.node - The selected node.
 * @returns The list.
 */
export function StyleRows(props: { readonly ctx: GameViewCtx; readonly node: SceneNode }): VNode {
  const { ctx, node } = props;
  const edits = editsOf(ctx.state.edits, editKey(node));
  return (
    <dl data-props="">
      {Object.entries(node.style ?? {}).map(([name, value]) => (
        <StyleRow
          key={name}
          ctx={ctx}
          owner={NODE}
          name={name}
          edits={edits}
          {...entryRow(name, value)}
        />
      ))}
    </dl>
  );
}

/**
 * The edits bar under the rows, while any element or text style key has a pending edit: "N edits
 * · M elements", "Copy for agent" (the agent text on the clipboard) and "Clear" (every edit
 * goes). It shows on an element without edits of its own too.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The bar, undefined without pending edits.
 */
export function EditsBar(props: { readonly ctx: GameViewCtx }): VNode | undefined {
  const { ctx } = props;
  const list = listEdits(ctx);
  if (list.length === 0) return undefined;
  return (
    <div data-part="edits">
      <span data-part="count">{countText(list)}</span>
      <button
        type="button"
        data-variant="primary"
        data-action="copy-edits"
        title="Copy the pending edits as text for the agent"
        onClick={() => void copyEdits(ctx)}
      >
        Copy for agent
      </button>
      <button
        type="button"
        data-variant="ghost"
        data-action="clear-edits"
        onClick={() => clearEdits(ctx, "all")}
      >
        Clear
      </button>
    </div>
  );
}
