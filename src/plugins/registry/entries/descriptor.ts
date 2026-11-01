/**
 * @file registry plugin — fresh frozen descriptors: only the manifest keys, never a door object
 * (doors carry functions). A command descriptor carries its build verdict and overlay marker.
 */
import type { CommandDescriptor, CommandRefusal, SourceDescriptor } from "../protocol";
import type { DoorCommand } from "../types";

/**
 * A fresh frozen source descriptor `{ id, title, input, changes }`.
 *
 * @param source - A door source or any source descriptor.
 * @returns The descriptor, without functions.
 * @example
 * ```ts
 * const read = () => [];
 * describeSource({ id: "game.history", title: "History", input: { last: "number?" }, changes: "edge", read });
 * // { id: "game.history", title: "History", input: { last: "number?" }, changes: "edge" }, frozen, no read
 * ```
 */
export function describeSource(source: SourceDescriptor): SourceDescriptor {
  return Object.freeze({
    id: source.id,
    title: source.title,
    input: Object.freeze({ ...source.input }),
    changes: source.changes
  });
}

/**
 * The `choices` key of a command descriptor: a fresh frozen copy of the list, or no key for a
 * missing or empty one, so a command without choices keeps the bytes of an older engine's descriptor.
 *
 * @param choices - The command's list.
 * @returns `{ choices }`, or `{}`.
 * @example
 * ```ts
 * choicesKey(["calm", "storm"]); // { choices: ["calm", "storm"] }, a frozen copy
 * choicesKey([]); // {}
 * ```
 */
function choicesKey(choices: readonly string[] | undefined): { choices?: readonly string[] } {
  if (choices === undefined || choices.length === 0) return {};

  return { choices: Object.freeze([...choices]) };
}

/**
 * A fresh frozen command descriptor `{ id, title, input, effect, overlay?, choices?, allowed, reason? }`:
 * the overlay marker when the command has one (never `value` or `choice`: a function is not JSON),
 * a frozen copy of `choices` when the list has a value, `allowed` always, and `reason` only when
 * the build refuses the command. An `allowed` or `reason` the given descriptor carries is dropped:
 * the registry owns them.
 *
 * @param command - A door command or any command descriptor.
 * @param refusal - Why this page's build refuses it; absent when it runs (an editor command).
 * @returns The descriptor, without functions.
 * @example
 * ```ts
 * const run = () => undefined;
 * describeCommand({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route", run }, "read-only");
 * // { id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route", allowed: false, reason: "read-only" }
 * ```
 */
export function describeCommand(
  command: CommandDescriptor | DoorCommand,
  refusal?: CommandRefusal
): CommandDescriptor {
  return Object.freeze({
    id: command.id,
    title: command.title,
    input: Object.freeze({ ...command.input }),
    effect: command.effect,
    ...(command.overlay === undefined ? {} : { overlay: command.overlay }),
    ...choicesKey(command.choices),
    allowed: refusal === undefined,
    ...(refusal === undefined ? {} : { reason: refusal })
  });
}
