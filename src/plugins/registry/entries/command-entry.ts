/**
 * @file registry plugin — the closure-erased command entry (door and module commands run through
 * the door `run`, which guards dev builds and taints cheats) and guardEntry for editor commands.
 * A door entry's descriptor carries the build's verdict; a refusal tagged `reason: "read-only"`
 * (the engine's controlReadOnly) or `reason: "dev-only"` (its controlRefused) becomes -32009, read
 * by its tag: the engine's error types are imported as types only.
 */
import type { Log } from "@moku-labs/common/browser";
import type { ControlReadOnlyError, ControlRefusedError } from "@moku-labs/game/control";
import { run } from "@moku-labs/game/control";
import type { InputOf, InputSchema, Json, RunResult } from "../protocol";
import { ProtocolError, refusalOf } from "../protocol";
import type { CommandEntry, DoorCommand, GameLike, RunnableCommand } from "../types";
import { describeCommand } from "./descriptor";
import {
  checkedInput,
  devOnlyRefusal,
  doorFailed,
  firstLine,
  messageOf,
  readOnlyRefusal,
  wireValueOf
} from "./failures";
import { readBuildInfo } from "./profile";
import { toggleValue } from "./toggles";

/**
 * The engine's refusal of a command by the page's build: `run` on a `--debug` page
 * (`controlReadOnly`, `reason: "read-only"`) or a door body on a page without the dev or debug
 * flag (`controlRefused`, `reason: "dev-only"`). Read by the tag, so any engine that tags its
 * refusals works.
 *
 * @param error - What the door run rejected with.
 * @returns Whether it is one of the two refusals.
 */
function isRefusal(error: unknown): error is ControlReadOnlyError | ControlRefusedError {
  const reason: unknown = Reflect.get(Object(error), "reason");
  return reason === "read-only" || reason === "dev-only";
}

/**
 * The error a door command's rejection becomes: -32009 for the build's refusals (`read_only` for
 * an error tagged `reason: "read-only"`, `dev_only` for `reason: "dev-only"`, logged at info),
 * -32000 with the first line for any other (logged at warn).
 *
 * @param id - The command id.
 * @param error - What the door run rejected with.
 * @param log - The registry log.
 * @returns The ProtocolError to reject with.
 */
function runFailure(id: string, error: unknown, log: Log.LogApi): ProtocolError {
  if (isRefusal(error)) {
    log.info("registry:command-refused", { id, reason: error.reason });
    return error.reason === "read-only" ? readOnlyRefusal(id) : devOnlyRefusal(id);
  }

  const message = firstLine(messageOf(error));
  log.warn("registry:command-failed", { id, message });
  return doorFailed(id, message);
}

/**
 * The plain command the engine's `run` takes for a door: its overlay members left out (a door may
 * carry any branch of the engine's overlay union; `run` reads `id`, `effect` and `run` only).
 *
 * @param door - The door command.
 * @returns A fresh runnable command whose run calls the door's.
 */
export function runnableOf(door: DoorCommand): RunnableCommand {
  return {
    id: door.id,
    title: door.title,
    input: door.input,
    effect: door.effect,
    run: (app: GameLike, input: InputOf<InputSchema>): unknown => door.run(app, input)
  };
}

/**
 * Builds the entry of a door (or module) command. Its `run` is async and never throws
 * synchronously. The descriptor's `allowed` / `reason` come from this page's build (its flags
 * never change); an overlay toggle's entry has `value()`.
 *
 * @param game - The game app.
 * @param door - The door command.
 * @param log - The registry log.
 * @returns The frozen entry.
 */
export function commandEntry(game: GameLike, door: DoorCommand, log: Log.LogApi): CommandEntry {
  const descriptor = describeCommand(door, refusalOf(readBuildInfo().profile, door.effect));
  const { id } = descriptor;
  const runnable = runnableOf(door);

  return Object.freeze({
    descriptor,
    /**
     * Runs the door command: checkInput, the door run (dev guard, cheat journal), toWireValue.
     *
     * @param raw - Raw input (`null` = none).
     * @returns The wire value and the run state of the game.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const input = checkedInput(id, door.input, raw);
      const ran = await run(game, runnable, input).catch((error: unknown) => {
        throw runFailure(id, error, log);
      });
      const { path, frame, tainted } = ran.state;

      return { value: wireValueOf(id, ran.value), state: { path, frame, tainted } };
    },
    ...(door.overlay === "toggle" ? { value: toggleValue(game, door, log) } : {})
  });
}

/**
 * A frozen copy of an editor command whose `run` maps any non-ProtocolError rejection (or
 * synchronous throw) to -32000 `command_failed` with the id; a ProtocolError passes unchanged.
 * An editor command runs no door, so every build allows it.
 *
 * @param entry - The editor command.
 * @returns The guarded copy, with a fresh frozen descriptor.
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
