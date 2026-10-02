/**
 * @file panels plugin — the type map from source ids to wire values and from command ids to
 * their inputs (type-only). The skeleton ships the fallback of 11-panels "Typing spike": every
 * value is Json, every input Json. The panels builder runs the spike first and replaces only this
 * file with the typed map over `@moku-labs/game/inspect` and `/control` (type imports only).
 */
import type { Json } from "../registry/protocol";

/**
 * Source id → wire value type of the game's door sources (fallback: none known yet).
 */
export type GameSourceValues = Record<never, never>;

/**
 * Command id → input type of the game's door commands (fallback: none known yet).
 */
export type GameCommandInputs = Record<never, never>;

/**
 * The value type a panel gets for a source id; unknown ids (and `.dev` ids) are Json.
 *
 * @example
 * ```ts
 * type Position = SourceValue<"game.position">;
 * ```
 */
export type SourceValue<Id extends string> = Id extends keyof GameSourceValues
  ? GameSourceValues[Id]
  : Json;

/**
 * The argument list of `tools.run.<name>` for a command id.
 *
 * @example
 * ```ts
 * type StepArgs = CommandArgs<"game.step">;
 * ```
 */
export type CommandArgs<Id> = Id extends keyof GameCommandInputs
  ? [input?: GameCommandInputs[Id]]
  : [input?: Json];
