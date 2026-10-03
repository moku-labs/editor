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
 * A fresh frozen command descriptor `{ id, title, input, effect }`.
 *
 * @param command - A door command or any command descriptor.
 * @returns The descriptor, without functions.
 * @example
 * ```ts
 * const run = () => undefined;
 * describeCommand({ id: "game.step", title: "Step frames", input: { frames: "number" }, effect: "cosmetic", run });
 * // { id: "game.step", title: "Step frames", input: { frames: "number" }, effect: "cosmetic" }, frozen, no run
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
