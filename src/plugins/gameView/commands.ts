/**
 * @file gameView plugin — the Game panel's command ids and the "is a game there to run them" check
 * every capture path makes first.
 */
import type { LinkApi } from "../link/types";
import type { Manifest } from "../registry/protocol";
import type { GameCommands } from "./types";

/**
 * The commands gameView runs, always through panels.run (R9).
 */
export const GAME_COMMANDS: GameCommands = {
  capture: "editor.capture",
  series: "editor.series",
  seriesStop: "editor.seriesStop"
};

/**
 * The overlay command workspace runs for the overlay switch.
 */
export const OVERLAY_COMMAND = "editor.overlay";

/**
 * Toast of a capture or series without a game (spec "capture").
 */
export const NO_GAME_TEXT = "No game to capture. Connect a game first.";

/**
 * Tooltip of the camera and Series controls when the game did not add the capture plugin.
 */
export const NO_CAPTURE_TEXT = "The game did not add capturePlugin";

/**
 * Tooltip of the overlay switch when the game did not add the overlay plugin.
 */
export const NO_OVERLAY_TEXT = "The game did not add the overlay";

/**
 * True when the manifest lists a command id.
 *
 * @param manifest - The game's manifest, undefined before a session.
 * @param id - A command id.
 * @returns Whether the game provides the command.
 * @example
 * ```ts
 * hasCommand(undefined, "editor.capture"); // false
 * ```
 */
export function hasCommand(manifest: Manifest | undefined, id: string): boolean {
  return manifest?.commands.some(command => command.id === id) ?? false;
}

/**
 * True when a game is connected (not empty, not connecting) and provides the command.
 *
 * @param link - The link api.
 * @param id - A command id.
 * @returns Whether the command can run now.
 */
export function gameReady(link: Pick<LinkApi, "status" | "manifest">, id: string): boolean {
  const { kind } = link.status();
  return kind !== "empty" && kind !== "connecting" && hasCommand(link.manifest(), id);
}
