/**
 * @file registry plugin — the closure-erased command entry (door and module commands run through
 * the door `run`, which guards dev builds and taints cheats) and guardEntry for editor commands.
 */
import type { Log } from "@moku-labs/common/browser";
import { run } from "@moku-labs/game/control";
import type { Json, RunResult } from "../protocol";
import { ProtocolError } from "../protocol";
import type { CommandEntry, DoorCommand, GameLike } from "../types";
import { describeCommand } from "./descriptor";
import { checkedInput, doorFailed, firstLine, messageOf, wireValueOf } from "./failures";

/**
 * Builds the entry of a door (or module) command. Its `run` is async and never throws
 * synchronously.
 *
 * @param game - The game app.
 * @param door - The door command.
 * @param log - The registry log.
 * @returns The frozen entry.
 * @example
 * ```ts
 * await commandEntry(game, commands.step, ctx.log).run({ frames: 1 }); // { value: { frame: 1841, … }, state: { … } }
 * ```
 */
export function commandEntry(game: GameLike, door: DoorCommand, log: Log.LogApi): CommandEntry {
  const descriptor = describeCommand(door);
  const { id } = descriptor;

  return Object.freeze({
    descriptor,
    /**
     * Runs the door command: checkInput, the door run (dev guard, cheat journal), toWireValue.
     *
     * @param raw - Raw input (`null` = none).
     * @returns The wire value and the run state of the game.
     * @example
     * ```ts
     * await entry.run({ frames: 1 }); // { value: { frame: 1841, … }, state: { path, frame, tainted } }
     * ```
     */
    run: async (raw: Json): Promise<RunResult> => {
      const input = checkedInput(id, door.input, raw);
      const ran = await run(game, door, input).catch((error: unknown) => {
        const message = firstLine(messageOf(error));
        log.warn("registry:command-failed", { id, message });
        throw doorFailed(id, message);
      });
      const { path, frame, tainted } = ran.state;

      return { value: wireValueOf(id, ran.value), state: { path, frame, tainted } };
    }
  });
}

/**
 * A frozen copy of an editor command whose `run` maps any non-ProtocolError rejection (or
 * synchronous throw) to -32000 `command_failed` with the id; a ProtocolError passes unchanged.
 *
 * @param entry - The editor command.
 * @returns The guarded copy, with a fresh frozen descriptor.
 * @example
 * ```ts
 * state.commands.set(entry.descriptor.id, guardEntry(entry));
 * ```
 */
export function guardEntry(entry: CommandEntry): CommandEntry {
  const descriptor = describeCommand(entry.descriptor);
  const { id } = descriptor;

  return Object.freeze({
    descriptor,
    /**
     * Runs the editor command; a non-ProtocolError failure becomes -32000 with the id.
     *
     * @param raw - Raw input; the editor command checks it itself.
     * @returns What the editor command answered.
     * @example
     * ```ts
     * await guarded.run({ on: true }); // { value: true, state: registry.envelope() }
     * ```
     */
    run: async (raw: Json): Promise<RunResult> => {
      try {
        return await entry.run(raw);
      } catch (error) {
        throw error instanceof ProtocolError ? error : doorFailed(id, firstLine(messageOf(error)));
      }
    }
  });
}
