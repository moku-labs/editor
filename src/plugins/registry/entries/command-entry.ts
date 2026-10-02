/**
 * @file registry plugin — entries/command-entry.ts (skeleton stubs, implemented in its wave).
 */

import type { Log } from "@moku-labs/common/browser";
import type { CommandEntry, DoorCommand, GameLike } from "../types";

/**
 * Skeleton stub for `commandEntry`; implemented in its wave.
 *
 * @param _game - The game.
 * @param _door - The door.
 * @param _log - The log.
 * @example
 * ```ts
 * commandEntry();
 * ```
 */
export function commandEntry(_game: GameLike, _door: DoorCommand, _log: Log.LogApi): CommandEntry {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `guardEntry`; implemented in its wave.
 *
 * @param _entry - The entry.
 * @example
 * ```ts
 * guardEntry();
 * ```
 */
export function guardEntry(_entry: CommandEntry): CommandEntry {
  throw new Error("not implemented");
}
