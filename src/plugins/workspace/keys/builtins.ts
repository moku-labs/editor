/**
 * @file workspace plugin — the built-in keys of design §4 (⌘1–⌘6 and bare 1–6, ⌘K, `.`, P, O,
 * G, R, H) and the Esc layers the shell owns (palette, the session and ⋯ menus, registry, step
 * popover, Reference mode). In Flow, flowView's H (History) wins over the global Hot reload key.
 */

import { closePopover, showWorkspace, stepOnce, togglePause, togglePreview } from "../actions";
import { toggleHotReload } from "../hot-reload";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "../ids";
import { setOverlayInGame } from "../overlay";
import { closePalette, togglePalette } from "../palette/items";
import { closeReference, toggleReference } from "../reference";
import type { KeyBinding, WorkspaceCtx } from "../types";
import { addEscapeLayer } from "./escape";
import { bindKey } from "./keymap";

/**
 * Binds a global key.
 *
 * @param ctx - Domain context of workspace.
 * @param keys - The combo or combos.
 * @param label - Shown in tooltips and the palette.
 * @param run - The action.
 * @param inInputs - Also while typing in a field.
 */
function bind(
  ctx: WorkspaceCtx,
  keys: KeyBinding["keys"],
  label: string,
  run: () => void,
  inInputs = false
): void {
  bindKey(ctx, inInputs ? { keys, label, run, inInputs } : { keys, label, run });
}

/**
 * Registers the built-in key bindings and Esc layers.
 *
 * @param ctx - Domain context of workspace.
 */
export function registerBuiltIns(ctx: WorkspaceCtx): void {
  const { state } = ctx;

  for (const [index, ws] of WORKSPACE_IDS.entries()) {
    bind(ctx, [`mod+${index + 1}`, `${index + 1}`], `Go to ${WORKSPACE_LABELS[ws]}`, () => {
      showWorkspace(ctx, ws);
    });
  }
  bind(ctx, "mod+k", "Command palette", () => togglePalette(ctx), true);
  bind(ctx, ".", "Step 1 frame", () => stepOnce(ctx, "key"));
  bind(ctx, "p", "Pause / resume", () => togglePause(ctx, "key"));
  bind(ctx, "o", "Overlay in game", () => {
    void setOverlayInGame(ctx, !state.overlayInGame, "key");
  });
  bind(ctx, "g", "Game preview", () => togglePreview(ctx));
  bind(ctx, "r", "Reference mode", () => toggleReference(ctx));
  bind(ctx, "h", "Hot reload", () => toggleHotReload(ctx));

  addEscapeLayer(ctx, "palette", () => {
    if (!state.palette.open) return false;
    closePalette(ctx);
    return true;
  });
  addEscapeLayer(ctx, "contextMenu", () => closePopover(state, "session"));
  addEscapeLayer(ctx, "contextMenu", () => closePopover(state, "more"));
  addEscapeLayer(ctx, "registry", () => closePopover(state, "registry"));
  addEscapeLayer(ctx, "stepPopover", () => closePopover(state, "step"));
  addEscapeLayer(ctx, "reference", () => closeReference(ctx));
}
