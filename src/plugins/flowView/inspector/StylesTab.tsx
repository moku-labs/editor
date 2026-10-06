/**
 * @file flowView inspector module — the Styles tab (C4): "Scene <scene> uses text styles from
 * <file> · Open in Files" (the text-styles file of the project index), the text-style select with no
 * card chosen until the person picks one ("Pick a text style"), read-only font, steppers only for
 * fields with a shared rule (R8), read-only swatches, the applied bar, the block excerpt with the
 * changed line. Fields shrink (M10).
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";
import { linkPlugin } from "../../link";
import type { StyleField } from "../../panels/shared/style-edit";
import {
  fieldRule,
  formatNumber,
  isStyleEditError,
  parseStyleFile
} from "../../panels/shared/style-edit";
import type { FlowActions, FlowCtx } from "../types";
import { useFlowStore } from "../useFlowStore";
import { styleErrorText } from "./styles";

/**
 * Props of `StylesTab`.
 */
export type StylesTabProps = {
  readonly ctx: FlowCtx;
  readonly actions: FlowActions;
  /** The scene of the shown node. */
  readonly scene: string | undefined;
};

/**
 * One field of a card: a stepper for a number field with a rule, else its value read-only (a swatch
 * for a colour identifier the file declares).
 *
 * @param props - The field, the card key, the pending value, the colours and the actions.
 * @param props.field - The field.
 * @param props.styleKey - The card key.
 * @param props.pending - The pending value of this field.
 * @param props.colours - Identifier → "#rrggbb".
 * @param props.actions - The flowView actions.
 * @returns The field row.
 * @example
 * ```tsx
 * <Field field={field} styleKey="ui.number" pending={undefined} colours={colours} actions={actions} />
 * ```
 */
function Field(props: {
  readonly field: StyleField;
  readonly styleKey: string;
  readonly pending: number | undefined;
  readonly colours: ReadonlyMap<string, string>;
  readonly actions: FlowActions;
}): VNode {
  const { field, styleKey, pending, colours, actions } = props;
  const rule =
    field.kind === "number" ? fieldRule({ kind: "text", key: styleKey }, field.path) : undefined;
  const colour = field.kind === "other" ? colours.get(field.raw) : undefined;
  return (
    <div data-field={field.path} data-read-only={rule === undefined ? "" : undefined}>
      <span data-part="label">{field.path}</span>
      {rule === undefined || field.kind !== "number" ? (
        <span data-part="value">
          {colour !== undefined && (
            <span data-part="swatch" style={{ background: colour }} aria-hidden="true" />
          )}
          <code>{field.raw}</code>
        </span>
      ) : (
        <span data-part="stepper">
          <button
            type="button"
            data-action="step-down"
            aria-label={`Decrease ${field.path}`}
            onClick={event => actions.inspector.stepStyle(field.path, -1, event.shiftKey)}
          >
            −
          </button>
          <code data-part="value">{pending === undefined ? field.raw : formatNumber(pending)}</code>
          <button
            type="button"
            data-action="step-up"
            aria-label={`Increase ${field.path}`}
            onClick={event => actions.inspector.stepStyle(field.path, 1, event.shiftKey)}
          >
            +
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * The Styles tab.
 *
 * @param props - Context, actions and the scene of the shown node.
 * @returns The tab body.
 */
export function StylesTab(props: StylesTabProps): VNode {
  const { ctx, actions, scene } = props;
  useFlowStore(ctx, state => state.view.revision);
  const styles = ctx.state.inspector.styles;
  const file = styles?.file;
  const key = styles?.key;
  const project = ctx.require(linkPlugin).project();
  const colours = useMemo(() => {
    const parsed = parseStyleFile(styles?.text ?? "");
    return isStyleEditError(parsed) ? new Map<string, string>() : parsed.colours;
  }, [styles?.text]);

  const header =
    file === undefined ? (
      <p data-part="header">{`Scene ${scene ?? "—"} · text styles`}</p>
    ) : (
      <p data-part="header">
        {`Scene ${scene ?? "—"} uses text styles from ${file} · `}
        <button
          type="button"
          data-action="open-files"
          onClick={() => actions.inspector.openInFiles(file)}
        >
          Open in Files
        </button>
      </p>
    );
  if (styles === undefined) {
    return (
      <div data-flow="styles-tab" data-part="body">
        {header}
        <p data-part="placeholder">Source loads from the dev server.</p>
      </div>
    );
  }
  if (styles.blocks.length === 0) {
    return (
      <div data-flow="styles-tab" data-part="body">
        {header}
        <p data-part="reason">
          {styleErrorText(styles.error ?? { error: "no-file" }, file, project)}
        </p>
      </div>
    );
  }

  const block = styles.blocks.find(entry => entry.ref.kind === "text" && entry.ref.key === key);
  const keys = styles.blocks.flatMap(entry => (entry.ref.kind === "text" ? [entry.ref.key] : []));
  const lines = styles.text.split(/\r?\n/);
  const changed = block?.fields.find(field => field.path === styles.pending?.path)?.line;
  return (
    <div data-flow="styles-tab" data-part="body">
      {header}
      <label data-part="key">
        <span>Text style</span>
        <select
          value={key ?? ""}
          onChange={event => actions.inspector.selectStyle(event.currentTarget.value)}
        >
          <option value="">Pick a text style</option>
          {keys.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {block !== undefined && key !== undefined && (
        <div data-part="card">
          {block.fields.map(field => (
            <Field
              key={field.path}
              field={field}
              styleKey={key}
              pending={styles.pending?.path === field.path ? styles.pending.next : undefined}
              colours={colours}
              actions={actions}
            />
          ))}
        </div>
      )}
      <p data-part="applied" data-ok={styles.result?.ok === false ? undefined : ""}>
        {styles.error === undefined
          ? (styles.result?.text ?? "Edits write to the file and reload the game.")
          : styleErrorText(styles.error, file, project)}
      </p>
      {block !== undefined && (
        <div data-part="excerpt">
          {lines.slice(block.line - 1, block.endLine).map((text, index) => (
            <div
              key={`${block.line + index}`}
              data-line={block.line + index}
              data-highlight={block.line + index === changed ? "" : undefined}
            >
              <span data-part="gutter">{block.line + index}</span>
              <code>{text}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
