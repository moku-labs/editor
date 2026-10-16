/**
 * @file registry plugin — overlay toggles of the game (engine spec 12 H4.4): the guarded `value()`
 * of a toggle's entry, and the source `editor.toggles` that answers every toggle's state over the
 * wire, for a tools page that draws the switches.
 */
import type { Log } from "@moku-labs/common/browser";
import type { CommandEntry, DoorCommand, DoorSource, GameLike } from "../types";
import { firstLine, messageOf } from "./failures";

/**
 * The id of the registry-built source of the overlay toggles.
 */
export const TOGGLES_ID = "editor.toggles";

/**
 * The guarded `value()` of an overlay toggle: it asks `door.value(game)`. A throw or an answer
 * that is not a boolean gives `undefined` and one `registry:value-failed` warn per streak; the
 * next good read ends the streak (the overlay paints at most 4 times a second).
 *
 * @param game - The game app.
 * @param door - The toggle command.
 * @param log - The registry log.
 * @returns The value function of the entry.
 */
export function toggleValue(
  game: GameLike,
  door: DoorCommand,
  log: Log.LogApi
): () => boolean | undefined {
  let failing = false;

  /**
   * Logs the first failure of a streak.
   *
   * @param message - What went wrong.
   * @returns Undefined, the value of a failed read.
   */
  const fail = (message: string): undefined => {
    if (!failing) log.warn("registry:value-failed", { id: door.id, message });
    failing = true;
    return undefined;
  };

  return () => {
    let value: unknown;
    try {
      value = door.value?.(game);
    } catch (error) {
      return fail(firstLine(messageOf(error)));
    }

    if (typeof value !== "boolean")
      return fail(`value(app) answered ${typeof value}, not a boolean`);

    failing = false;
    return value;
  };
}

/**
 * The wire state of one toggle: its value, or null when its `value()` failed.
 *
 * @param entry - The command entry of a toggle.
 * @returns true, false or null.
 * @example
 * ```ts
 * toggleState({ descriptor, run, value: () => undefined }); // null
 * ```
 */
function toggleState(entry: CommandEntry): boolean | null {
  // eslint-disable-next-line unicorn/no-null -- JSON null: the toggle's value() failed
  return entry.value?.() ?? null;
}

/**
 * The source `editor.toggles`, built as a door source so it goes through the same entry as a door
 * (checked input, wire values, guarded watch). Its read answers `{ [id]: boolean | null }` for every
 * toggle in catalogue order, `null` when the toggle's `value()` failed.
 *
 * @param toggles - The command entries of the game's toggles, in catalogue order.
 * @returns The door source.
 * @example
 * ```ts
 * togglesSource([glow, fog]).read(app, {}); // { "garden.glow": true, "garden.fog": null }
 * ```
 */
export function togglesSource(toggles: readonly CommandEntry[]): DoorSource {
  return {
    id: TOGGLES_ID,
    title: "Overlay toggles",
    input: {},
    changes: "frame",
    read: () => Object.fromEntries(toggles.map(entry => [entry.descriptor.id, toggleState(entry)]))
  };
}
