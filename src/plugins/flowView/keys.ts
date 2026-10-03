/**
 * @file flowView plugin — the Flow keys (design §4) bound through workspace.keys with
 * `workspace: "flow"`, and the four Esc layers in their fixed rank: contextMenu → noteEditor →
 * codeEdit → selection.
 */
import type { EscLayer, KeyBinding } from "../workspace/types";
import { KEY_OPS } from "./camera/input";
import { viewportCentre } from "./palette";
import type { FlowActions, FlowCtx } from "./types";

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
 * The Flow key bindings.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The bindings.
 */
export function flowKeys(ctx: FlowCtx, actions: FlowActions): KeyBinding[] {
  /**
   * True while the neighbours strip is open (the arrow keys walk it).
   *
   * @returns Whether the strip is open.
   * @example
   * ```ts
   * stripOpen(); // true after a node was selected
   * ```
   */
  const stripOpen = (): boolean => ctx.state.focus.strip;
  /**
   * True while the Code tab edits or the note editor is open (⌘S saves).
   *
   * @returns Whether something can be saved.
   * @example
   * ```ts
   * editing(); // true in Code edit mode
   * ```
   */
  const editing = (): boolean =>
    ctx.state.inspector.code?.draft !== undefined || ctx.state.notes.editor !== undefined;
  return [
    flowKey("n", "Note", () => actions.notes.edit({ anchor: viewportCentre(ctx) })),
    flowKey("h", "History", () => actions.focus.history()),
    ...KEY_OPS.map(row => flowKey(row.keys, row.label, () => actions.camera.run(row.op))),
    flowKey("arrowleft", "Walk to Comes from", () => actions.focus.walk("prev"), {
      when: stripOpen
    }),
    flowKey("arrowright", "Walk to Goes to", () => actions.focus.walk("next"), { when: stripOpen }),
    flowKey("arrowup", "Move the highlight up", () => actions.focus.moveHighlight(-1), {
      when: stripOpen
    }),
    flowKey("arrowdown", "Move the highlight down", () => actions.focus.moveHighlight(1), {
      when: stripOpen
    }),
    flowKey("enter", "Focus the card", () => {
      const root = ctx.state.view.root;
      const active = root?.ownerDocument.activeElement;
      const card =
        active instanceof HTMLElement ? active.closest<HTMLElement>("[data-key]") : undefined;
      const key = card?.dataset.key;
      if (
        root !== undefined &&
        card !== undefined &&
        card !== null &&
        key !== undefined &&
        root.contains(card)
      ) {
        actions.focus.select(key);
      }
    }),
    flowKey(
      "mod+s",
      "Save",
      event => {
        event.preventDefault();
        if (ctx.state.notes.editor === undefined) actions.inspector.saveCode().catch(() => {});
        else actions.notes.save().catch(() => {});
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
    ["noteEditor", () => actions.notes.close()],
    ["codeEdit", () => actions.inspector.cancelEdit()],
    ["selection", () => actions.focus.leave()]
  ];
}
