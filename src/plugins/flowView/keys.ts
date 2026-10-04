/**
 * @file flowView plugin — the Flow keys (design §4) bound through workspace.keys with
 * `workspace: "flow"`: history, camera ops, the Info tab walk (← → ↑ ↓ Enter with a selection),
 * Back (Alt+←), Find current (C), the Inspector panel (\), Save; and the three Esc layers in
 * their fixed rank: contextMenu → codeEdit → selection.
 */
import { toggleSidePanel } from "../panels/shared/side-panel";
import type { EscLayer, KeyBinding } from "../workspace/types";
import { KEY_OPS } from "./camera/input";
import type { FlowActions, FlowCtx } from "./types";

/**
 * The SidePanel id of the Inspector.
 */
export const INSPECTOR_PANEL = "flow.inspector";

/**
 * Widgets that own the arrow keys while they have focus (the Inspector tabs, a resize handle, a
 * menu, a select): the walk keys leave them alone.
 */
const ARROW_WIDGETS =
  '[role="tablist"], [role="separator"], [role="menu"], [role="listbox"], select';

/**
 * Native controls whose Enter is their own click.
 */
const CONTROLS = 'button, a[href], input, select, textarea, [role="tab"], [role="menuitem"]';

/**
 * True when the focused element sits inside an element matching the selector.
 *
 * @param selector - A CSS selector.
 * @returns Whether focus is inside such an element.
 * @example
 * ```ts
 * focusIn('[role="tablist"]'); // true while an Inspector tab has focus
 * ```
 */
function focusIn(selector: string): boolean {
  const active = globalThis.document?.activeElement;
  return active instanceof Element && active.closest(selector) !== null;
}

/**
 * Builds a Flow key binding.
 *
 * @param keys - The combo(s).
 * @param label - Tooltip and palette label.
 * @param run - What the key does.
 * @param extra - when, inInputs.
 * @returns The binding.
 * @example
 * ```ts
 * flowKey("h", "History", () => actions.focus.history());
 * ```
 */
function flowKey(
  keys: string | readonly string[],
  label: string,
  run: (event: KeyboardEvent) => void,
  extra: Pick<KeyBinding, "when" | "inInputs"> = {}
): KeyBinding {
  return { keys, label, run, workspace: "flow", ...extra };
}

/**
 * The item key of the card that has keyboard focus inside the Flow root.
 *
 * @param ctx - Domain context of flowView.
 * @returns The key, or undefined when no card has focus.
 */
function focusedCard(ctx: FlowCtx): string | undefined {
  const root = ctx.state.view.root;
  const active = root?.ownerDocument.activeElement;
  const card =
    active instanceof HTMLElement
      ? (active.closest<HTMLElement>("[data-key]") ?? undefined)
      : undefined;
  if (root === undefined || card === undefined || !root.contains(card)) return undefined;
  return card.dataset.key;
}

/**
 * The Flow key bindings.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The bindings.
 */
export function flowKeys(ctx: FlowCtx, actions: FlowActions): KeyBinding[] {
  /**
   * True while something is selected and no arrow-key widget has focus (the arrow keys walk the
   * Info tab rows).
   *
   * @returns Whether the arrows walk.
   */
  const walking = (): boolean => ctx.state.focus.selected !== undefined && !focusIn(ARROW_WIDGETS);
  /**
   * True while Enter has a row to follow or a card has focus, and no control takes it: a button
   * inside a frame or card (the frame's Collapse) clicks by its own Enter.
   *
   * @returns Whether Enter belongs to Flow.
   */
  const entering = (): boolean => {
    if (focusIn(CONTROLS)) return false;
    const { focus } = ctx.state;
    const following = focus.selected !== undefined && focus.highlight.index >= 0;
    return focusedCard(ctx) !== undefined || following;
  };
  /**
   * True while a followed edge left a selection to go back to.
   *
   * @returns Whether Back has somewhere to go.
   */
  const canGoBack = (): boolean => ctx.state.focus.back.length > 0;
  /**
   * True while the Code tab edits (⌘S saves).
   *
   * @returns Whether there is a draft.
   */
  const editing = (): boolean => ctx.state.inspector.code?.draft !== undefined;
  return [
    flowKey("h", "History", () => actions.focus.history()),
    ...KEY_OPS.map(row => flowKey(row.keys, row.label, () => actions.camera.run(row.op))),
    flowKey("c", "Show where the game is", () => actions.focus.findCurrent()),
    flowKey("\\", "Collapse or expand the Inspector", () => toggleSidePanel(INSPECTOR_PANEL)),
    flowKey("arrowleft", "Walk to Comes from", () => actions.focus.walk("prev"), {
      when: walking
    }),
    flowKey("arrowright", "Walk to Outcomes", () => actions.focus.walk("next"), {
      when: walking
    }),
    flowKey("arrowup", "Move the highlight up", () => actions.focus.moveHighlight(-1), {
      when: walking
    }),
    flowKey("arrowdown", "Move the highlight down", () => actions.focus.moveHighlight(1), {
      when: walking
    }),
    flowKey("alt+arrowleft", "Back", () => actions.focus.back(), { when: canGoBack }),
    flowKey(
      "enter",
      "Follow the highlighted row, or focus the card",
      () => {
        // The focused card wins only when it is not the selection and no row is highlighted.
        const { focus } = ctx.state;
        const card = focusedCard(ctx);
        const isHighlighted = focus.highlight.index >= 0;
        const isOtherCard = card !== undefined && card !== focus.selected && !isHighlighted;
        if (!isOtherCard && actions.focus.followHighlight()) return;
        if (card !== undefined) actions.focus.select(card);
      },
      { when: entering }
    ),
    flowKey(
      "mod+s",
      "Save",
      event => {
        event.preventDefault();
        actions.inspector.saveCode().catch(() => {});
      },
      { when: editing, inInputs: true }
    )
  ];
}

/**
 * The Esc layers flowView owns, in rank order; each close returns false when nothing is open.
 *
 * @param actions - The flowView actions.
 * @returns Layer and close pairs.
 */
export function escapeLayers(actions: FlowActions): [EscLayer, () => boolean][] {
  return [
    ["contextMenu", () => actions.focus.closeMenu()],
    ["codeEdit", () => actions.inspector.cancelEdit()],
    ["selection", () => actions.focus.leave()]
  ];
}
