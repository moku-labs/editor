/**
 * @file workspace plugin — E1, the command palette: a modal `<dialog>` (top layer) with a
 * combobox input and a listbox of groups in fixed order, headed with their totals; matches are
 * highlighted with `<mark>`; ↑/↓ move, ↵ runs, ⇧↵ runs the alt action, a click runs; disabled
 * items show their reason dimmed; the footer shows the key hints and the counts.
 */
import type { VNode } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { linkPlugin } from "../../link";
import type { PaletteMatch, WorkspaceCtx } from "../types";
import { Icon } from "../ui/icons";
import { useElement, useWorkspace } from "../ui/store";
import { closePalette, flatItems, groupedItems, runPaletteItem, type ShownItem } from "./items";

/**
 * Props of `Palette`.
 */
export type PaletteProps = { readonly ctx: WorkspaceCtx };

/**
 * Id of the result list.
 */
const LIST_ID = "moku-palette-list";

/**
 * Id of a result option.
 *
 * @param index - The option index.
 * @returns The element id.
 * @example
 * ```ts
 * optionId(2); // "moku-palette-option-2"
 * ```
 */
function optionId(index: number): string {
  return `moku-palette-option-${index}`;
}

/**
 * A label with its matched ranges in `<mark>`.
 *
 * @param label - The label.
 * @param match - The match, undefined without a query.
 * @returns Text and marks.
 * @example
 * ```tsx
 * <span>{highlight("board/merge", { score: 80, ranges: [[6, 9]] })}</span>
 * ```
 */
export function highlight(label: string, match: PaletteMatch | undefined): (string | VNode)[] {
  const parts: (string | VNode)[] = [];
  let from = 0;
  for (const [start, end] of match?.ranges ?? []) {
    if (start > from) parts.push(label.slice(from, start));
    parts.push(<mark key={start}>{label.slice(start, end)}</mark>);
    from = end;
  }
  if (from < label.length) parts.push(label.slice(from));
  return parts;
}

/**
 * Moves the active option with ↑/↓ and runs it with ↵ / ⇧↵; ⌘K closes.
 *
 * @param ctx - Domain context of workspace.
 * @param event - The keydown in the input.
 * @param shown - The shown items.
 * @example
 * ```ts
 * onKey(ctx, event, flat);
 * ```
 */
function onKey(ctx: WorkspaceCtx, event: KeyboardEvent, shown: readonly ShownItem[]): void {
  const { palette } = ctx.state;
  const count = shown.length;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (count === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    palette.index = (palette.index + step + count) % count;
    ctx.state.ui.bump();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const entry = shown[palette.index];
    if (entry !== undefined) runPaletteItem(ctx, entry.item, event.shiftKey);
    return;
  }
  if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    closePalette(ctx);
  }
}

/**
 * One result option.
 *
 * @param props - Context, entry, index and whether it is active.
 * @param props.ctx - Domain context of workspace.
 * @param props.entry - The item and its match.
 * @param props.index - Its index in the shown list.
 * @param props.active - Whether it is the active option.
 * @returns The option.
 * @example
 * ```tsx
 * <Option ctx={ctx} entry={entry} index={0} active />
 * ```
 */
function Option(props: {
  readonly ctx: WorkspaceCtx;
  readonly entry: ShownItem;
  readonly index: number;
  readonly active: boolean;
}): VNode {
  const { ctx, entry, index, active } = props;
  const { item, match } = entry;
  const reason = item.disabled?.() ?? false;

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: listbox with aria-activedescendant; the combobox input keeps the focus
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are handled on the combobox input
    <div
      role="option"
      id={optionId(index)}
      aria-selected={active}
      aria-disabled={reason === false ? undefined : true}
      data-active={active ? "" : undefined}
      data-mono={item.mono === true ? "" : undefined}
      onClick={event => runPaletteItem(ctx, item, event.shiftKey)}
      onPointerMove={() => {
        if (ctx.state.palette.index === index) return;
        ctx.state.palette.index = index;
        ctx.state.ui.bump();
      }}
    >
      <span data-label>{highlight(item.label, match)}</span>
      {item.hint !== undefined && <span data-hint>{item.hint}</span>}
      {reason !== false && <span data-reason>{reason}</span>}
      {active && item.alt !== undefined && <span data-chip>{`${item.alt.label} ⇧↵`}</span>}
      {item.shortcut !== undefined && <kbd>{item.shortcut}</kbd>}
    </div>
  );
}

/**
 * The command palette.
 *
 * @param props - The workspace domain context.
 * @returns The dialog.
 * @example
 * ```tsx
 * <Palette ctx={ctx} />
 * ```
 */
export function Palette(props: PaletteProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const dialog = useElement<HTMLDialogElement>();
  const input = useElement<HTMLInputElement>();
  const { open, query, items } = state.palette;
  const views = open ? groupedItems(items, query) : [];
  const shown = flatItems(views);
  const index = Math.min(state.palette.index, Math.max(0, shown.length - 1));

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === undefined) return;
    if (open && !element.open) {
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) element.close();
  });

  const all = [...items.values()];
  const nodes = all.filter(item => item.group === "Nodes").length;
  const textures = all.filter(item => item.group === "Textures").length;
  const commands = ctx.require(linkPlugin).manifest()?.commands.length ?? 0;
  let position = -1;

  return (
    <dialog
      data-ui="palette"
      aria-label="Command palette"
      ref={dialog.ref}
      onCancel={event => {
        event.preventDefault();
        closePalette(ctx);
      }}
      onClose={() => {
        if (state.palette.open) closePalette(ctx);
      }}
    >
      {open && (
        <>
          <label data-search>
            <Icon name="search" />
            <input
              ref={input.ref}
              role="combobox"
              aria-expanded="true"
              aria-controls={LIST_ID}
              aria-autocomplete="list"
              aria-activedescendant={shown.length === 0 ? undefined : optionId(index)}
              aria-label="Search"
              placeholder="Jump to a node, file, style, texture, panel or run a command"
              value={query}
              onInput={event => {
                state.palette.query = event.currentTarget.value;
                state.palette.index = 0;
                state.ui.bump();
              }}
              onKeyDown={event => onKey(ctx, event, shown)}
            />
          </label>
          <div id={LIST_ID} role="listbox" aria-label="Results">
            {views.length === 0 && (
              <p data-empty>No match. Try a node name, a file or a texture key.</p>
            )}
            {views.map(view => (
              <section key={view.group} aria-label={`${view.group} ${view.total}`}>
                <h3>
                  {view.group} <span>{view.total}</span>
                </h3>
                {view.items.map(entry => {
                  position += 1;
                  return (
                    <Option
                      key={entry.item.id}
                      ctx={ctx}
                      entry={entry}
                      index={position}
                      active={position === index}
                    />
                  );
                })}
              </section>
            ))}
          </div>
          <footer>
            <span>
              <kbd>↑↓</kbd> move <kbd>↵</kbd> run <kbd>⇧↵</kbd> alt <kbd>Esc</kbd> close
            </span>
            <span
              data-mono
            >{`${nodes} nodes · ${textures} textures · ${commands} game commands`}</span>
          </footer>
        </>
      )}
    </dialog>
  );
}
