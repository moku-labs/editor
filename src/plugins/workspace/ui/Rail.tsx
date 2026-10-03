/**
 * @file workspace plugin — B2, the left rail: six workspace buttons (icon + label,
 * `aria-current="page"` on the active one, tooltip "Flow ⌘1", roving tabindex with ↑/↓), the
 * rail badges (amber, red for errors; the label spoken in full) and "⌘ Commands" at the bottom.
 */
import type { VNode } from "preact";
import { showWorkspace } from "../actions";
import { formatCombo, isApplePlatform } from "../keys/keymap";
import { openPalette } from "../palette/items";
import type { WorkspaceCtx } from "../types";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "../workspaces";
import { Icon } from "./icons";
import { useWorkspace } from "./store";
import { badgeSpeech } from "./text";

/**
 * Props of `Rail`.
 */
export type RailProps = { readonly ctx: WorkspaceCtx };

/**
 * The ⌘1–⌘6 combos, in rail order.
 */
const MOD_DIGITS: readonly string[] = WORKSPACE_IDS.map((_ws, index) => `mod+${index + 1}`);

/**
 * How far ↑/↓ move the rail focus.
 */
const FOCUS_STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * Moves the focus to the previous or next rail button (↑/↓, wrapping).
 *
 * @param event - The keydown on the rail.
 */
function moveFocus(event: KeyboardEvent): void {
  const step = FOCUS_STEPS[event.key];
  const nav = event.currentTarget;
  if (step === undefined || !(nav instanceof HTMLElement)) return;

  const buttons = [...nav.querySelectorAll<HTMLButtonElement>("button[data-workspace]")];
  const focused = nav.ownerDocument.activeElement;
  const index = focused instanceof HTMLButtonElement ? buttons.indexOf(focused) : -1;
  const next = buttons.at((index + step) % buttons.length);
  event.preventDefault();
  next?.focus();
}

/**
 * The rail.
 *
 * @param props - The workspace domain context.
 * @returns The navigation.
 */
export function Rail(props: RailProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  useWorkspace(state.ui, () => state.ui.version);
  const apple = isApplePlatform(globalThis.navigator);

  return (
    <nav data-ui="rail" aria-label="Workspaces" onKeyDown={moveFocus}>
      <ul>
        {WORKSPACE_IDS.map((ws, index) => {
          const label = WORKSPACE_LABELS[ws];
          const badge = state.badges[ws];
          const current = state.active === ws;
          return (
            <li key={ws}>
              <button
                type="button"
                data-workspace={ws}
                aria-current={current ? "page" : undefined}
                aria-label={badge === undefined ? label : `${label}, ${badgeSpeech(badge.label)}`}
                tabIndex={current ? 0 : -1}
                title={`${label} ${formatCombo(MOD_DIGITS[index] ?? "", apple)}`}
                onClick={() => showWorkspace(ctx, ws)}
              >
                <Icon name={ws} size={18} />
                <span data-label>{label}</span>
                {badge !== undefined && (
                  <span data-badge data-tone={badge.tone} aria-hidden="true">
                    {badge.count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-commands
        title={`Commands ${formatCombo("mod+k", apple)}`}
        onClick={() => openPalette(ctx)}
      >
        <Icon name="commands" />
        <span data-label>Commands</span>
      </button>
    </nav>
  );
}
