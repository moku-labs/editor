/**
 * @file overlay plugin — the Game tab's view model (C4, F6): the game's commands marked for the
 * overlay, their rows, the refusal reasons, and the tabs of the card. Pure.
 */
import type { CommandDescriptor, CommandRefusal } from "../../registry/protocol";
import { isAllowed } from "../../registry/protocol";
import type { OverlayCommand, OverlayRegistry, OverlayTab } from "../types";
import type { GameRow, GameView, ToastView } from "./types";

/** The refusal text of a plain `--debug` build. */
export const READ_ONLY_TEXT = "needs a --debug=full build";

/** The refusal text of a page without the debug or dev flags. */
const DEV_ONLY_TEXT = "needs a dev or debug build";

/** The tabs with and without the Game tab. */
const WITH_GAME: readonly OverlayTab[] = ["frames", "game", "record", "link"];
const WITHOUT_GAME: readonly OverlayTab[] = ["frames", "record", "link"];

/**
 * The text of a refusal.
 *
 * @param reason - The descriptor's refusal; a refused descriptor without one reads as read-only.
 * @returns The text.
 * @example
 * ```ts
 * reasonText("dev-only"); // "needs a dev or debug build"
 * ```
 */
export function reasonText(reason: CommandRefusal | undefined): string {
  return reason === "dev-only" ? DEV_ONLY_TEXT : READ_ONLY_TEXT;
}

/**
 * One overlay command from its descriptor; a toggle's value read now (when asked).
 *
 * @param descriptor - A manifest command with an overlay marker.
 * @param kind - Its marker.
 * @param value - The toggle's value function, if any.
 * @returns The overlay command.
 */
function commandOf(
  descriptor: CommandDescriptor,
  kind: "toggle" | "button",
  value: (() => boolean | undefined) | undefined
): OverlayCommand {
  const allowed = isAllowed(descriptor);
  return {
    id: descriptor.id,
    title: descriptor.title,
    kind,
    value: kind === "toggle" ? value?.() : undefined,
    effect: descriptor.effect,
    allowed,
    reason: allowed ? undefined : reasonText(descriptor.reason)
  };
}

/**
 * The game's commands marked for the overlay, in manifest order. A toggle's value is read now
 * (`command(id).value()`, the engine's `value(app)`) only when `withValues`.
 *
 * @param registry - The registry's manifest and command lookup.
 * @param withValues - Read the toggles' values (the Game tab shows).
 * @returns Fresh overlay commands.
 */
export function overlayCommands(
  registry: Pick<OverlayRegistry, "manifest" | "command">,
  withValues = true
): OverlayCommand[] {
  const commands: OverlayCommand[] = [];
  for (const descriptor of registry.manifest().commands) {
    const kind = descriptor.overlay;
    if (kind === undefined) continue;
    const value = withValues ? registry.command(descriptor.id)?.value : undefined;
    commands.push(commandOf(descriptor, kind, value));
  }
  return commands;
}

/**
 * The card's tabs: Frames, Game (only with overlay commands), Record, Link.
 *
 * @param hasCommands - Whether the game registered overlay commands.
 * @returns The tabs, in order.
 * @example
 * ```ts
 * tabsOf(false); // ["frames", "record", "link"]
 * ```
 */
export function tabsOf(hasCommands: boolean): readonly OverlayTab[] {
  return hasCommands ? WITH_GAME : WITHOUT_GAME;
}

/**
 * One Game tab row: toggle ON / OFF, button RUN; a refused command greyed with its reason; a
 * command in flight busy.
 *
 * @param command - The overlay command.
 * @param busy - Whether its run has not settled.
 * @returns The row.
 */
function rowOf(command: OverlayCommand, busy: boolean): GameRow {
  const toggle = command.kind === "toggle";
  const on = command.value === true;
  let state: GameRow["state"] = "run";
  if (toggle) state = on ? "on" : "off";
  if (busy) state = "busy";
  if (!command.allowed) state = "refused";
  let legend: GameRow["legend"] = "RUN";
  if (toggle) legend = on ? "ON" : "OFF";
  return {
    id: command.id,
    name: command.title,
    line: command.allowed
      ? `${command.id}, ${command.effect} ${command.kind}`
      : `${command.id}, ${command.reason ?? READ_ONLY_TEXT}`,
    state,
    legend,
    toggle,
    pressed: toggle ? on : undefined,
    disabled: !command.allowed || busy,
    title: command.allowed ? undefined : command.reason
  };
}

/**
 * The Game tab rows.
 *
 * @param commands - The overlay commands.
 * @param busy - Command ids whose run has not settled.
 * @returns The rows, in order.
 */
export function gameRows(
  commands: readonly OverlayCommand[],
  busy: ReadonlySet<string>
): readonly GameRow[] {
  return commands.map(command => rowOf(command, busy.has(command.id)));
}

/**
 * The Game tab: the by-line, the rows, the READ-ONLY note when any command is refused read-only,
 * and the toast.
 *
 * @param game - The manifest's game name.
 * @param commands - The overlay commands.
 * @param busy - Command ids whose run has not settled.
 * @param toast - The toast line, if any.
 * @returns The Game tab view.
 */
export function gameView(
  game: string,
  commands: readonly OverlayCommand[],
  busy: ReadonlySet<string>,
  toast: ToastView | undefined
): GameView {
  return {
    by: `Added by ${game}`,
    rows: gameRows(commands, busy),
    readOnly: commands.some(command => command.reason === READ_ONLY_TEXT),
    toast
  };
}
