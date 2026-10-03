/**
 * @file registry plugin — fresh frozen descriptors: only the manifest keys, never a door object
 * (doors carry functions).
 */
import type { CommandDescriptor, SourceDescriptor } from "../protocol";

/**
 * A fresh frozen source descriptor `{ id, title, input, changes }`.
 *
 * @param source - A door source or any source descriptor.
 * @returns The descriptor, without functions.
 * @example
 * ```ts
 * describeSource(sources.history); // { id: "game.history", title: "History", input: { last: "number?" }, changes: "edge" }
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
 * A fresh frozen command descriptor `{ id, title, input, effect }`.
 *
 * @param command - A door command or any command descriptor.
 * @returns The descriptor, without functions.
 * @example
 * ```ts
 * describeCommand(commands.step); // { id: "game.step", title: "Step frames", input: { … }, effect: "cosmetic" }
 * ```
 */
export function describeCommand(command: CommandDescriptor): CommandDescriptor {
  return Object.freeze({
    id: command.id,
    title: command.title,
    input: Object.freeze({ ...command.input }),
    effect: command.effect
  });
}
